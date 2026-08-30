import { existsSync, mkdirSync, watch } from "node:fs";
import { dirname } from "node:path";
import { handoffPath, readHandoff } from "@revue/prep";
import type { HandoffRecord } from "@revue/types";

// A CLI process blocks for the next handoff rather than polling for it, so the wait must not miss
// a write that lands between the first read and the watch attaching. This waiter is deliberately
// separate from the TUI's own run watcher (watch.ts), which stays TUI-specific and interactive.

export type WaitForHandoffInput = {
	repositoryRoot: string;
	/** The handoff id already seen; any different id resolves the wait. */
	since: string | null;
	timeoutMs: number;
	signal?: AbortSignal;
};

export type WaitForHandoffResult = { kind: "ready"; record: HandoffRecord } | { kind: "timeout" };

const HANDOFF_FILE = "handoff.json";

const isHandoffChange = (filename: string | null): boolean =>
	filename === null ||
	filename === HANDOFF_FILE ||
	(filename.startsWith(`${HANDOFF_FILE}.`) && filename.endsWith(".tmp"));

const freshRecord = (repositoryRoot: string, since: string | null): HandoffRecord | null => {
	const { record } = readHandoff(repositoryRoot);
	if (!record) return null;
	return record.handoffId !== since ? record : null;
};

/**
 * Resolves once a handoff whose id differs from `since` exists. Read, watch, then read again so a
 * write landing between the first read and the watch attaching is never missed.
 */
export const waitForHandoff = async ({
	repositoryRoot,
	since,
	timeoutMs,
	signal,
}: WaitForHandoffInput): Promise<WaitForHandoffResult> => {
	const immediate = freshRecord(repositoryRoot, since);
	if (immediate) return { kind: "ready", record: immediate };

	const revueDirectory = dirname(handoffPath(repositoryRoot));
	if (!existsSync(revueDirectory)) mkdirSync(revueDirectory, { recursive: true });

	return new Promise((resolve) => {
		let settled = false;
		let watcher: ReturnType<typeof watch> | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const finish = (result: WaitForHandoffResult) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			watcher?.close();
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};

		const check = () => {
			const record = freshRecord(repositoryRoot, since);
			if (record) finish({ kind: "ready", record });
		};

		const onAbort = () => finish({ kind: "timeout" });

		try {
			watcher = watch(revueDirectory, (_event, filename) => {
				if (isHandoffChange(filename === null ? null : String(filename))) check();
			});
			watcher.on("error", () => {});
		} catch {
			watcher = null;
		}

		// A write between the first read above and the watch attaching here must still be caught.
		check();
		if (settled) return;

		timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
		signal?.addEventListener("abort", onAbort);
	});
};
