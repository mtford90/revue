import { randomUUID } from "node:crypto";
import { finaliseHandoff, readAgentOrigin, readHandoff, writeHandoff } from "@revue/prep";
import {
	type AgentOrigin,
	HANDOFF_DELIVERY_KIND,
	HANDOFF_SCHEMA_VERSION,
	type HandoffDelivery,
	type HandoffRecord,
	type ReviewThread,
} from "@revue/types";
import type { HostAdapter, HostTerminal } from "./host.ts";
import { unsentThreads } from "./threads.ts";

// Send is one action with a durable half and a courtesy half. This controller owns both, so the
// TUI holds only the key, the notice, and whatever the reviewer has to choose; a render test hands
// the app a fake and never touches the disk.

export const WAKE_UP_PROMPT =
	"Review feedback is waiting in revue: run `revue status --json` and follow the revue skill's " +
	'"Responding to review feedback" step.';

export type SendOutcome =
	| { kind: "nothing" }
	| { kind: "queued"; count: number }
	/** The choice the reviewer has yet to make: more than one terminal could be the target. */
	| { kind: "choose"; count: number; handoffId: string; candidates: readonly HostTerminal[] }
	| { kind: "delivered"; count: number; title: string }
	/** The prompt is on the clipboard: either no host exists, or the host could not reach a terminal. */
	| { kind: "copied"; count: number; reason: CopyReason }
	| { kind: "error"; message: string };

export type CopyReason = "no-host" | "unreached";

export type SendOptions = {
	/** Forces the picker even when a session target or origin would otherwise settle it. */
	choose?: boolean;
};

export type FeedbackController = {
	/**
	 * Write the unsent threads as one handoff. Reports what the reviewer should be told.
	 * `copyPrompt` is the clipboard fallback used when no terminal receives the prompt; it stands
	 * in for a call the TUI makes because only it has a renderer to copy through.
	 */
	send(copyPrompt?: CopyPrompt, options?: SendOptions): Promise<SendOutcome>;
	/** Delivers a queued handoff to the terminal the reviewer picked, guarded by `handoffId` so a
	 * newer Send is never overwritten by a slower, older choice. The terminal becomes the session
	 * target for later Sends. */
	deliverTo(
		handoffId: string,
		terminal: HostTerminal,
		copyPrompt?: CopyPrompt,
	): Promise<SendOutcome>;
	/** Whether a host is present to deliver to, which is what gates the "another terminal" menu item. */
	hasHost: boolean;
};

export type FeedbackControllerInput = {
	repositoryRoot: string;
	/** The run the reviewer is reading: what the batch is requested against, not where it is read. */
	runId: string;
	threads: () => readonly ReviewThread[];
	/** Absent outside a host that can type for the reviewer, which is where the clipboard takes over. */
	host?: HostAdapter | null;
};

type CopyPrompt = (text: string) => boolean;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const queuedHandoff = (runId: string, threads: readonly ReviewThread[]): HandoffRecord => ({
	schemaVersion: HANDOFF_SCHEMA_VERSION,
	handoffId: randomUUID(),
	requestedAt: new Date().toISOString(),
	runId,
	threadIds: threads.map((thread) => thread.id),
	delivery: { kind: "queued" },
});

export const createFeedbackController = ({
	repositoryRoot,
	runId,
	threads,
	host,
}: FeedbackControllerInput): FeedbackController => {
	// A terminal the reviewer has chosen once outlives the Send that chose it, so later Sends do
	// not ask again while it is still there to answer.
	const sessionTarget: SessionTargetRef = { current: null };
	return {
		async send(copyPrompt?: CopyPrompt, options?: SendOptions): Promise<SendOutcome> {
			// A damaged record reads as absent, which sends the whole open conversation again. That is
			// the safe way round: the agent re-reads feedback rather than never hearing it.
			const previous = readHandoff(repositoryRoot).record;
			const unsent = unsentThreads(threads(), previous);
			if (unsent.length === 0) return { kind: "nothing" };
			const record = queuedHandoff(runId, unsent);
			try {
				writeHandoff(repositoryRoot, record);
			} catch (error) {
				return { kind: "error", message: describe(error) };
			}
			const fallback = {
				repositoryRoot,
				handoffId: record.handoffId,
				count: unsent.length,
				copyPrompt,
			};
			if (!host) return copiedOrQueued({ ...fallback, reason: "no-host" });
			const outcome = await deliver({
				host,
				repositoryRoot,
				runId,
				handoffId: record.handoffId,
				count: unsent.length,
				sessionTarget,
				forceChoose: options?.choose ?? false,
			});
			// A host that reached nobody leaves the reviewer holding the prompt, so the manual
			// path is always there; a choice still to make is not a failure.
			return outcome.kind === "queued"
				? copiedOrQueued({ ...fallback, reason: "unreached" })
				: outcome;
		},
		async deliverTo(
			handoffId: string,
			terminal: HostTerminal,
			copyPrompt?: CopyPrompt,
		): Promise<SendOutcome> {
			if (!host) return { kind: "queued", count: 0 };
			const current = readHandoff(repositoryRoot).record;
			// A newer Send replaced the record while the picker was open. That Send owns delivery
			// now, so this choice neither nudges anyone nor claims a batch of its own.
			if (current?.handoffId !== handoffId) return { kind: "queued", count: 0 };
			const count = current.threadIds.length;
			if (!(await trySendPrompt(host, terminal.handle))) {
				return copiedOrQueued({
					repositoryRoot,
					handoffId,
					count,
					copyPrompt,
					reason: "unreached",
				});
			}
			const outcome = delivered({ repositoryRoot, handoffId, count, target: terminal });
			if (outcome.kind === "delivered") sessionTarget.current = terminal;
			return outcome;
		},
		hasHost: Boolean(host),
	};
};

type SessionTargetRef = { current: HostTerminal | null };

type DeliveryInput = {
	host: HostAdapter;
	repositoryRoot: string;
	/** The run this batch was requested against, which the recorded origin is matched to. */
	runId: string;
	handoffId: string;
	count: number;
	sessionTarget: SessionTargetRef;
	forceChoose: boolean;
};

const deliver = async ({
	host,
	repositoryRoot,
	runId,
	handoffId,
	count,
	sessionTarget,
	forceChoose,
}: DeliveryInput): Promise<SendOutcome> => {
	const terminals = await tryListTerminals(host);
	if (!terminals) return { kind: "queued", count };
	forgetVanishedSessionTarget(sessionTarget, terminals);
	if (forceChoose) return chooseOrQueued(terminals, count, handoffId);
	const target = resolveTarget({
		terminals,
		sessionTarget: sessionTarget.current,
		origin: readAgentOrigin(repositoryRoot).origin,
		runId,
	});
	if (!target) return chooseOrQueued(terminals, count, handoffId);
	if (!(await trySendPrompt(host, target.handle))) return { kind: "queued", count };
	const outcome = delivered({ repositoryRoot, handoffId, count, target });
	if (outcome.kind === "delivered") sessionTarget.current = target;
	return outcome;
};

/** A session target the host no longer lists is forgotten, not carried forward as a dead handle. */
const forgetVanishedSessionTarget = (
	sessionTarget: SessionTargetRef,
	terminals: readonly HostTerminal[],
): void => {
	const live = sessionTarget.current
		? terminals.some((terminal) => terminal.paneKey === sessionTarget.current?.paneKey)
		: true;
	if (!live) sessionTarget.current = null;
};

/** The picker a reviewer chooses from when nothing else has settled it; an empty list stays queued. */
const chooseOrQueued = (
	candidates: readonly HostTerminal[],
	count: number,
	handoffId: string,
): SendOutcome =>
	candidates.length > 0
		? { kind: "choose", count, handoffId, candidates }
		: { kind: "queued", count };

const delivered = ({
	repositoryRoot,
	handoffId,
	count,
	target,
}: Omit<DeliveryInput, "host" | "runId" | "sessionTarget" | "forceChoose"> & {
	target: HostTerminal;
}): SendOutcome => {
	const finalised = tryFinalise(repositoryRoot, handoffId, {
		kind: HANDOFF_DELIVERY_KIND.DELIVERED,
		host: "orca",
		terminal: target.handle,
		title: target.title,
	});
	// A later Send has already replaced the record, and its own delivery owns the outcome now.
	return finalised ? { kind: "delivered", count, title: target.title } : { kind: "queued", count };
};

/** The record is on disk with the feedback in it either way, so a rewrite that fails reads as a
 * delivery that did not happen rather than as a Send the reviewer has to worry about. */
const tryFinalise = (
	repositoryRoot: string,
	handoffId: string,
	delivery: HandoffDelivery,
): boolean => {
	try {
		return finaliseHandoff(repositoryRoot, handoffId, delivery);
	} catch {
		return false;
	}
};

/**
 * Where the nudge goes: the terminal the reviewer chose last, when the host still lists it; then
 * the pane the agent last worked in, when the host still lists it and it worked on this review;
 * then the one terminal left. One origin is recorded at a time, so an origin carrying another
 * review's run is a weak signal: it wakes that pane only when there is no other pane to wake, and
 * the reviewer chooses whenever there is.
 */
const resolveTarget = ({
	terminals,
	sessionTarget,
	origin,
	runId,
}: {
	terminals: readonly HostTerminal[];
	sessionTarget: HostTerminal | null;
	origin: AgentOrigin | null;
	runId: string;
}): HostTerminal | null => {
	const session = terminals.find((terminal) => terminal.paneKey === sessionTarget?.paneKey);
	if (session) return session;
	const recorded = terminals.find((terminal) => terminal.paneKey === origin?.paneKey);
	if (recorded && origin?.runId === runId) return recorded;
	return terminals.length === 1 ? (terminals[0] ?? null) : null;
};

const tryListTerminals = async (host: HostAdapter): Promise<HostTerminal[] | null> => {
	try {
		return await host.listTerminals();
	} catch {
		return null;
	}
};

const trySendPrompt = async (host: HostAdapter, handle: string): Promise<boolean> => {
	try {
		return await host.sendToTerminal(handle, WAKE_UP_PROMPT);
	} catch {
		return false;
	}
};

const copiedOrQueued = ({
	repositoryRoot,
	handoffId,
	count,
	copyPrompt,
	reason,
}: {
	repositoryRoot: string;
	handoffId: string;
	count: number;
	copyPrompt?: CopyPrompt;
	reason: CopyReason;
}): SendOutcome =>
	tryCopyPrompt(repositoryRoot, handoffId, copyPrompt)
		? { kind: "copied", count, reason }
		: { kind: "queued", count };

const tryCopyPrompt = (
	repositoryRoot: string,
	handoffId: string,
	copyPrompt?: CopyPrompt,
): boolean => {
	if (!copyPrompt) return false;
	try {
		if (!copyPrompt(WAKE_UP_PROMPT)) return false;
	} catch {
		return false;
	}
	return tryFinalise(repositoryRoot, handoffId, { kind: HANDOFF_DELIVERY_KIND.COPIED });
};
