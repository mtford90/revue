import { randomUUID } from "node:crypto";
import { readHandoff, writeHandoff } from "@revue/prep";
import { HANDOFF_SCHEMA_VERSION, type HandoffRecord, type ReviewThread } from "@revue/types";
import { unsentThreads } from "./threads.ts";

// Send is one action with a durable half and a courtesy half. This controller owns both, so the
// TUI holds only the key, the notice, and whatever the reviewer has to choose; a render test hands
// the app a fake and never touches the disk.

export type SendOutcome =
	| { kind: "nothing" }
	| { kind: "queued"; count: number }
	| { kind: "error"; message: string };

export type FeedbackController = {
	/** Write the unsent threads as one handoff. Reports what the reviewer should be told. */
	send(): Promise<SendOutcome>;
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
	async send(): Promise<SendOutcome> {
		// A damaged record reads as absent, which sends the whole open conversation again. That is
		// the safe way round: the agent re-reads feedback rather than never hearing it.
		const previous = readHandoff(repositoryRoot).record;
		const unsent = unsentThreads(threads(), previous?.requestedAt ?? null);
		if (unsent.length === 0) return { kind: "nothing" };
		try {
			writeHandoff(repositoryRoot, queuedHandoff(runId, unsent));
		} catch (error) {
			return { kind: "error", message: describe(error) };
		}
		return { kind: "queued", count: unsent.length };
	},
});
