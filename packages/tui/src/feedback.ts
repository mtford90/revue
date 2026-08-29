import { randomUUID } from "node:crypto";
import { finaliseHandoff, readHandoff, writeHandoff } from "@revue/prep";
import {
	HANDOFF_DELIVERY_KIND,
	HANDOFF_SCHEMA_VERSION,
	type HandoffRecord,
	type ReviewThread,
} from "@revue/types";
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
		// No host module exists yet: delivery always falls through to the clipboard fallback. The
		// Orca delivery ticket plugs a host attempt in ahead of this step.
		const copied = tryCopyPrompt(repositoryRoot, record.handoffId, copyPrompt);
		return copied
			? { kind: "copied", count: unsent.length }
			: { kind: "queued", count: unsent.length };
	},
});

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
