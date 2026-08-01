import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffLayout = "split" | "stack";
export type DiffSide = "additions" | "deletions";

export interface DiffStats {
	additions: number;
	deletions: number;
}

export interface DiffFileInput {
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
}

export interface DiffFile extends Omit<DiffFileInput, "stats" | "path" | "language"> {
	path: string;
	language: string;
	stats: DiffStats;
}

/** A 1-based, inclusive, side-aware range to decorate. */
export interface RangeDecoration {
	/** Stable identity for this exact range. */
	id: string;
	/** Stable identity shared by ranges belonging to one focused item. */
	focusId?: string;
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
}

/** The first concrete rendered line to which focus/navigation can scroll. */
export interface DecorationAnchor {
	decorationId: string;
	focusId: string;
	fileId: string;
	filePath: string;
	hunkIndex: number;
	side: DiffSide;
	lineNumber: number;
}

export interface RenderSpan {
	text: string;
	fg?: string;
}

export interface DiffCell {
	kind: "context" | "addition" | "deletion" | "empty";
	text: string;
	spans: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	/** Exact decoration ids for each side of this cell. */
	decorations: Partial<Record<DiffSide, string[]>>;
	focusedSides: DiffSide[];
}

export type DiffRow =
	| { type: "hunk-header"; key: string; hunkIndex: number; text: string }
	| {
			type: "split-line";
			key: string;
			hunkIndex: number;
			old: DiffCell;
			new: DiffCell;
	  }
	| { type: "stack-line"; key: string; hunkIndex: number; cell: DiffCell };
