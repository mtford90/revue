import { existsSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readRunRecords } from "@revue/prep";

// A review is a conversation, so the open TUI notices what the agent writes rather than waiting to
// be asked. Only two things on disk are worth noticing: the thread store changing under the review,
// and a run appearing that continues the one on screen.

export type RunWatchEvent =
	| { kind: "threads-changed" }
	| { kind: "run-superseded"; runId: string; directory: string };

export type WatchRunInput = {
	/** The repository-local thread store, rewritten by rename from here and from other terminals. */
	threadsPath: string;
	runsDirectory: string;
	/** The run on screen: a superseding run is one whose manifest names this one. */
	runId: string;
	onEvent: (event: RunWatchEvent) => void;
	debounceMs?: number;
};

/** Long enough to swallow the burst one rewrite makes, short enough that a reply still feels live. */
export const WATCH_DEBOUNCE_MS = 120;

const CHAPTERS_FILE = "chapters.json";

const isThreadStoreChange = (filename: string | null, threadsName: string) =>
	filename === null ||
	filename === threadsName ||
	(filename.startsWith(`${threadsName}.`) && filename.endsWith(".tmp"));

type Debounced = { trigger: () => void; cancel: () => void };

const debounce = (delay: number, action: () => void): Debounced => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return {
		trigger: () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				action();
			}, delay);
		},
		cancel: () => {
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
};

/**
 * Directories are watched rather than files: every writer here replaces its file by rename, so a
 * watch on the inode itself would follow the replaced file and go silent after the first write.
 */
const watchDirectory = (
	directory: string,
	onChange: (filename: string | null) => void,
): { close: () => void } | null => {
	try {
		const watcher = watch(directory, (_event, filename) =>
			onChange(filename === null ? null : String(filename)),
		);
		// A directory that disappears mid-review ends the watch; it must never end the review.
		watcher.on("error", () => {});
		return watcher;
	} catch {
		return null;
	}
};

/** Watch a run's neighbourhood for the two changes a reviewer cares about. Returns a disposer. */
export const watchRun = ({
	threadsPath,
	runsDirectory,
	runId,
	onEvent,
	debounceMs = WATCH_DEBOUNCE_MS,
}: WatchRunInput): (() => void) => {
	let live = true;
	const watchers: { close: () => void }[] = [];
	const watchedRuns = new Set<string>();

	const track = (watcher: { close: () => void } | null) => {
		if (watcher) watchers.push(watcher);
	};

	const inspectRuns = async () => {
		const records = await readRunRecords(runsDirectory).catch(() => []);
		if (!live) return;
		for (const { directory, manifest } of records) {
			if (manifest.supersedes !== runId) continue;
			// The directory lands long before the narration does, so watch it and ask again rather
			// than answering once: a half-written run must never announce itself.
			if (!watchedRuns.has(directory)) {
				watchedRuns.add(directory);
				track(watchDirectory(directory, () => runs.trigger()));
			}
			if (existsSync(join(directory, CHAPTERS_FILE))) {
				onEvent({ kind: "run-superseded", runId: manifest.runId, directory });
			}
		}
	};

	const threads = debounce(debounceMs, () => {
		if (live && existsSync(threadsPath)) onEvent({ kind: "threads-changed" });
	});
	const runs = debounce(debounceMs, () => {
		void inspectRuns();
	});

	track(
		watchDirectory(dirname(threadsPath), (filename) => {
			if (isThreadStoreChange(filename, basename(threadsPath))) threads.trigger();
		}),
	);
	track(watchDirectory(runsDirectory, () => runs.trigger()));
	// A superseding run may already be waiting when the review opens.
	runs.trigger();

	return () => {
		live = false;
		threads.cancel();
		runs.cancel();
		for (const watcher of watchers) watcher.close();
	};
};
