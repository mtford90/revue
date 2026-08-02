export type { DiffFile, DiffFileInput, DiffStats } from "@revue/diff-model";

export type DiffLayout = "split" | "stack";
export type DiffSide = "additions" | "deletions";

export type DiffLineRange = {
	filePath: string;
	hunkOldStart: number;
	side: DiffSide;
	startLine: number;
	endLine: number;
};

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

export type DiffInlineAttachment = {
	id: string;
	anchor: DiffLineRange;
	content: React.ReactNode;
};

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
