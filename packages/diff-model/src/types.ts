import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffStats = {
	additions: number;
	deletions: number;
};

export type DiffFileInput = {
	id: string;
	metadata: FileDiffMetadata;
	language?: string;
	path?: string;
	previousPath?: string;
	patch?: string;
	stats?: DiffStats;
	isBinary?: boolean;
	isTooLarge?: boolean;
	statsTruncated?: boolean;
};

export type DiffFile = Omit<DiffFileInput, "stats" | "path" | "language"> & {
	path: string;
	language: string;
	stats: DiffStats;
};
