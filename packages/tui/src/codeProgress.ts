import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	loadPreparedRun,
	type PreparedRun,
	type ReviewUnit,
	readRunRecords,
	reviewUnits,
} from "@revue/prep";
import {
	type CodeProgress,
	CodeProgressSchema,
	emptyViewState,
	type RevueChaptersFile,
	RevueChaptersFileSchema,
	type ViewState,
	ViewStateSchema,
	viewStateFileId,
	viewStateHunkId,
} from "@revue/types";
import {
	ALL_FILES_CHAPTER_ID,
	ReviewSessionStateSchema,
	runKey,
	type ViewStateStore,
} from "./viewState.ts";

export type CodeReviewRun = PreparedRun & { chapters: RevueChaptersFile | null };
const codeKey = (runId: string) => `code:${runId}`;
const unitId = (unit: ReviewUnit) => viewStateHunkId(unit.filePath, unit.oldStart);
const contentId = (unit: ReviewUnit) => JSON.stringify([unit.filePath, unit.signature]);

/** Uniqueness is measured against each complete run, never only its reviewed subset. */
const uniqueUnits = (units: ReviewUnit[]): Map<string, ReviewUnit> => {
	const unique = new Map<string, ReviewUnit>();
	const ambiguous = new Set<string>();
	for (const unit of units) {
		const key = contentId(unit);
		if (unique.has(key)) ambiguous.add(key);
		unique.set(key, unit);
	}
	for (const key of ambiguous) unique.delete(key);
	return unique;
};

/** Editorial delta matching is deliberately not evidence for a review tick. */
export function carryHunkProgress(
	previous: PreparedRun,
	next: PreparedRun,
	reviewed: readonly string[],
): string[] {
	const before = reviewUnits(previous);
	const after = reviewUnits(next);
	const marks = new Set(reviewed);
	if (previous.manifest.runId === next.manifest.runId) {
		return after.map(unitId).filter((id) => marks.has(id));
	}
	const source = uniqueUnits(before);
	const destination = uniqueUnits(after);
	return after.flatMap((unit) => {
		const key = contentId(unit);
		const matched = source.get(key);
		return destination.has(key) && matched && marks.has(unitId(matched)) ? [unitId(unit)] : [];
	});
}

/** Decode only narration we actually have; a historical narration hash cannot recover ownership. */
const migrateLegacy = (run: CodeReviewRun, state: ViewState): string[] => {
	const units = reviewUnits(run);
	const reviewed = new Set<string>();
	for (const chapter of run.chapters?.chapters ?? []) {
		for (const reference of chapter.hunkRefs) {
			if (
				state.chapters.includes(chapter.id) ||
				state.files.includes(viewStateFileId(chapter.id, reference.filePath))
			)
				reviewed.add(viewStateHunkId(reference.filePath, reference.oldStart));
		}
	}
	return units.flatMap((unit) =>
		reviewed.has(unitId(unit)) ||
		state.chapters.includes(ALL_FILES_CHAPTER_ID) ||
		state.files.includes(viewStateFileId(ALL_FILES_CHAPTER_ID, unit.filePath))
			? [unitId(unit)]
			: [],
	);
};

const parseViewState = (value: unknown): ViewState => {
	const result = ViewStateSchema.safeParse(value);
	return result.success ? result.data : emptyViewState();
};

/** Presence, not positive marks, makes any saved destination authoritative. */
const availableProgress = (
	all: Record<string, unknown>,
	run: CodeReviewRun,
): CodeProgress | undefined => {
	const storedKey = codeKey(run.manifest.runId);
	if (Object.hasOwn(all, storedKey)) {
		const parsed = CodeProgressSchema.safeParse(all[storedKey]);
		// A damaged initialized record must not resurrect an ancestor's positive marks either.
		return parsed.success ? parsed.data : { version: 1, hunks: [] };
	}
	const currentKey = runKey(run.manifest.runId, run.chapters);
	const flatKey = runKey(run.manifest.runId, null);
	const legacyKey = Object.hasOwn(all, currentKey) ? currentKey : flatKey;
	if (!Object.hasOwn(all, legacyKey)) return undefined;
	return { version: 1, hunks: migrateLegacy(run, parseViewState(all[legacyKey])) };
};

const narrationFor = async (run: PreparedRun): Promise<CodeReviewRun> => {
	try {
		const file = JSON.parse(await readFile(join(run.directory, "chapters.json"), "utf8"));
		return { ...run, chapters: RevueChaptersFileSchema.parse(file) };
	} catch {
		return { ...run, chapters: null };
	}
};

type OpenCodeReviewStoreInput = {
	path: string;
	run: CodeReviewRun;
	runsDirectory: string;
	/** The actual run replaced by either reload path, including entirely flat reviews. */
	previous?: CodeReviewRun;
};

const carrySource = async (
	input: OpenCodeReviewStoreInput,
	all: Record<string, unknown>,
): Promise<{ run: CodeReviewRun; progress: CodeProgress } | undefined> => {
	const records = await readRunRecords(input.runsDirectory);
	const byId = new Map(records.map((record) => [record.manifest.runId, record]));
	// A persisted continuation records the flat reload that seeded progress, not immutable
	// lineage. It may fill a missing manifest link, but must never bypass one: doing so lets a
	// pending run from a sibling narrated branch seed this opening.
	const parentOf = (id: string): string | undefined => {
		const immutable = byId.get(id)?.manifest.supersedes;
		if (immutable) return immutable;
		const saved = CodeProgressSchema.safeParse(all[codeKey(id)]);
		return saved.success ? saved.data.continuedFrom : undefined;
	};
	const ancestors = new Set<string>();
	for (const start of [input.run.manifest.supersedes, input.previous?.manifest.runId]) {
		let id = start;
		while (id && !ancestors.has(id)) {
			ancestors.add(id);
			id = parentOf(id);
		}
	}
	const continuesAncestor = (id: string): boolean => {
		const seen = new Set<string>();
		while (!seen.has(id)) {
			if (ancestors.has(id)) return true;
			if (byId.get(id)?.narrated) return false;
			seen.add(id);
			const parent = parentOf(id);
			if (!parent) return false;
			id = parent;
		}
		return false;
	};
	const candidates = records.filter(
		({ manifest, narrated }) =>
			manifest.runId !== input.run.manifest.runId &&
			(ancestors.has(manifest.runId) ||
				(!narrated &&
					manifest.createdAt <= input.run.manifest.createdAt &&
					continuesAncestor(manifest.runId))),
	);
	if (
		input.previous &&
		!candidates.some(({ manifest }) => manifest.runId === input.previous?.manifest.runId)
	) {
		candidates.push({
			directory: input.previous.directory,
			manifest: input.previous.manifest,
			narrated: input.previous.chapters !== null,
		});
	}
	candidates.sort(
		(a, b) =>
			b.manifest.createdAt.localeCompare(a.manifest.createdAt) ||
			b.manifest.runId.localeCompare(a.manifest.runId),
	);
	for (const candidate of candidates) {
		const run =
			candidate.manifest.runId === input.previous?.manifest.runId
				? input.previous
				: await loadPreparedRun(candidate.directory)
						.then(narrationFor)
						.catch(() => undefined);
		if (!run) continue;
		const progress = availableProgress(all, run);
		if (progress) return { run, progress };
	}
	return undefined;
};

const readRecords = (path: string): Record<string, unknown> => {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
};

/** One opening/carry boundary for code, with narration-sensitive questions and location beside it. */
export async function openCodeReviewStore(
	input: OpenCodeReviewStoreInput,
): Promise<ViewStateStore> {
	const { path, run } = input;
	const all = readRecords(path);
	const key = runKey(run.manifest.runId, run.chapters);
	const stored = all[key];
	const narrative = parseViewState(stored);
	const sessionResult = ReviewSessionStateSchema.safeParse(
		stored && typeof stored === "object" ? ((stored as { session?: unknown }).session ?? {}) : {},
	);
	let session = sessionResult.success ? sessionResult.data : { pages: {} };
	let progress = availableProgress(all, run);
	if (!progress) {
		const source = await carrySource(input, all);
		progress = {
			version: 1,
			hunks: source ? carryHunkProgress(source.run, run, source.progress.hunks) : [],
			...(source ? { continuedFrom: source.run.manifest.runId } : {}),
		};
	}
	const validIds = new Set(reviewUnits(run).map(unitId));
	const explicitChapters = new Set(
		(run.chapters?.chapters ?? [])
			.filter((chapter) => !chapter.hunkRefs.length)
			.map((chapter) => chapter.id),
	);
	const normalize = (state: ViewState): ViewState => ({
		chapters: state.chapters.filter((id) => explicitChapters.has(id)),
		files: [],
		keyChanges: state.keyChanges,
		hunks: [...new Set(state.hunks ?? [])].filter((id) => validIds.has(id)),
	});
	let current = normalize({ ...narrative, hunks: progress.hunks });
	const save = (code: boolean) => {
		const latest = readRecords(path);
		const { hunks: _hunks, ...narration } = current;
		latest[key] = { ...narration, session };
		if (code) latest[codeKey(run.manifest.runId)] = { ...progress, hunks: current.hunks };
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
		} catch {
			// Repository-owned reviewer state is best effort: a read-only checkout still reviews.
		}
	};
	// Initialization itself is durable, even before the first tick or after a fully empty carry.
	save(true);
	return {
		get: () => current,
		set: (next) => {
			current = normalize(next);
			save(true);
		},
		getSession: () => session,
		setSession: (next) => {
			session = ReviewSessionStateSchema.parse(next);
			save(false);
		},
	};
}
