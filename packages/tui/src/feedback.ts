import { randomUUID } from "node:crypto";
import { finaliseHandoff, readAgentOrigin, readHandoff, writeHandoff } from "@revue/prep";
import {
	type AgentOrigin,
	HANDOFF_DELIVERY_KIND,
	HANDOFF_SCHEMA_VERSION,
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
	/** `candidates` is the choice the reviewer has yet to make: more than one terminal could be it. */
	| { kind: "queued"; count: number; candidates?: readonly HostTerminal[] }
	| { kind: "delivered"; count: number; title: string }
	| { kind: "copied"; count: number }
	| { kind: "error"; message: string };

export type FeedbackController = {
	/**
	 * Write the unsent threads as one handoff. Reports what the reviewer should be told.
	 * `copyPrompt` is the clipboard fallback used when there is no host to deliver to; it stands
	 * in for a call the TUI makes because only it has a renderer to copy through.
	 */
	send(copyPrompt?: (text: string) => boolean): Promise<SendOutcome>;
};

export type FeedbackControllerInput = {
	repositoryRoot: string;
	/** The run the reviewer is reading: what the batch is requested against, not where it is read. */
	runId: string;
	threads: () => readonly ReviewThread[];
	/** Absent outside a host that can type for the reviewer, which is where the clipboard takes over. */
	host?: HostAdapter | null;
};

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
}: FeedbackControllerInput): FeedbackController => ({
	async send(copyPrompt?: (text: string) => boolean): Promise<SendOutcome> {
		// A damaged record reads as absent, which sends the whole open conversation again. That is
		// the safe way round: the agent re-reads feedback rather than never hearing it.
		const previous = readHandoff(repositoryRoot).record;
		const unsent = unsentThreads(threads(), previous?.requestedAt ?? null);
		if (unsent.length === 0) return { kind: "nothing" };
		const record = queuedHandoff(runId, unsent);
		try {
			writeHandoff(repositoryRoot, record);
		} catch (error) {
			return { kind: "error", message: describe(error) };
		}
		// A host owns delivery outright. The clipboard is for a reviewer nothing can type for, not
		// a second attempt after the host has declined.
		const count = unsent.length;
		if (host) return await deliver({ host, repositoryRoot, handoffId: record.handoffId, count });
		return tryCopyPrompt(repositoryRoot, record.handoffId, copyPrompt)
			? { kind: "copied", count }
			: { kind: "queued", count };
	},
});

type DeliveryInput = {
	host: HostAdapter;
	repositoryRoot: string;
	handoffId: string;
	count: number;
};

const deliver = async ({
	host,
	repositoryRoot,
	handoffId,
	count,
}: DeliveryInput): Promise<SendOutcome> => {
	const terminals = await tryListTerminals(host);
	if (!terminals) return { kind: "queued", count };
	const target = resolveTarget(terminals, readAgentOrigin(repositoryRoot).origin);
	// The picker a reviewer chooses from is the TUI's, and it is the next slice's work; until then
	// an undecidable list stays queued and its candidates ride out with the outcome.
	if (!target) return queuedWithChoice(count, terminals);
	if (!(await trySendPrompt(host, target.handle))) return { kind: "queued", count };
	return delivered({ repositoryRoot, handoffId, count, target });
};

const queuedWithChoice = (count: number, candidates: readonly HostTerminal[]): SendOutcome =>
	candidates.length > 1 ? { kind: "queued", count, candidates } : { kind: "queued", count };

const delivered = ({
	repositoryRoot,
	handoffId,
	count,
	target,
}: Omit<DeliveryInput, "host"> & { target: HostTerminal }): SendOutcome => {
	const finalised = finaliseHandoff(repositoryRoot, handoffId, {
		kind: HANDOFF_DELIVERY_KIND.DELIVERED,
		host: "orca",
		terminal: target.handle,
		title: target.title,
	});
	// A later Send has already replaced the record, and its own delivery owns the outcome now.
	return finalised ? { kind: "delivered", count, title: target.title } : { kind: "queued", count };
};

/**
 * Where the nudge goes: the pane the agent last worked in, when the host still lists it, and
 * otherwise the one terminal left. A run the origin does not share with this review is a weaker
 * signal but not a wrong one — a single origin is recorded at a time, so there is no better-matched
 * pane to prefer over it, and the last agent to work the review is still the one to wake.
 */
const resolveTarget = (
	terminals: readonly HostTerminal[],
	origin: AgentOrigin | null,
): HostTerminal | null => {
	const recorded = terminals.find((terminal) => terminal.paneKey === origin?.paneKey);
	if (recorded) return recorded;
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

const tryCopyPrompt = (
	repositoryRoot: string,
	handoffId: string,
	copyPrompt?: (text: string) => boolean,
): boolean => {
	if (!copyPrompt) return false;
	try {
		if (!copyPrompt(WAKE_UP_PROMPT)) return false;
	} catch {
		return false;
	}
	return finaliseHandoff(repositoryRoot, handoffId, { kind: HANDOFF_DELIVERY_KIND.COPIED });
};
