/** One parsed source line, including Pierre's retained trailing line ending when present. */
export type DiffLine = string;

/** Revue-owned file statuses normalised from a unified patch. */
export type DiffStatus = "change" | "rename-pure" | "rename-changed" | "new" | "deleted";

export type DiffContextContent = {
	type: "context";
	lines: number;
	additionLineIndex: number;
	deletionLineIndex: number;
};

export type DiffChangeContent = {
	type: "change";
	deletions: number;
	deletionLineIndex: number;
	additions: number;
	additionLineIndex: number;
};

export type DiffHunkContent = DiffContextContent | DiffChangeContent;

/** The subset of parsed hunk metadata Revue consumes, independent of Pierre's public shape. */
export type DiffHunk = {
	collapsedBefore: number;
	additionStart: number;
	additionCount: number;
	additionLines: number;
	additionLineIndex: number;
	deletionStart: number;
	deletionCount: number;
	deletionLines: number;
	deletionLineIndex: number;
	hunkContent: DiffHunkContent[];
	hunkContext?: string;
	hunkSpecs?: string;
	splitLineStart: number;
	splitLineCount: number;
	unifiedLineStart: number;
	unifiedLineCount: number;
	noEOFCRDeletions: boolean;
	noEOFCRAdditions: boolean;
};

/** Revue's structural parsed-file metadata. Pierre types do not cross this boundary. */
export type DiffMetadata = {
	name: string;
	prevName?: string;
	newObjectId?: string;
	prevObjectId?: string;
	mode?: string;
	prevMode?: string;
	type: DiffStatus;
	hunks: DiffHunk[];
	splitLineCount: number;
	unifiedLineCount: number;
	isPartial: boolean;
	deletionLines: DiffLine[];
	additionLines: DiffLine[];
	cacheKey?: string;
};

export type DiffStats = {
	additions: number;
	deletions: number;
};

export type DiffFileInput = {
	id: string;
	metadata: DiffMetadata;
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

export type DiffLayout = "split" | "stack";
export type DiffSide = "additions" | "deletions";

export type DiffLineRange = {
	filePath: string;
	hunkOldStart: number;
	side: DiffSide;
	startLine: number;
	endLine: number;
};

/** Presentation-neutral identity of one source line in a parsed review hunk. */
export type DiffSourceLineIdentity = {
	fileId: string;
	filePath: string;
	hunkIndex: number;
	hunkOldStart: number;
	side: DiffSide;
	lineNumber: number;
};

/** A 1-based, inclusive, side-aware range to decorate. */
export interface RangeDecoration {
	id: string;
	focusId?: string;
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
	active?: boolean;
	backgroundColor?: string;
	showGutterMarker?: boolean;
}

/** The first concrete source line to which focus/navigation can scroll. */
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
	bg?: string;
	bold?: boolean;
	dim?: boolean;
}

/** A 0-based, end-exclusive char range within one line's raw text. */
export type EmphasisRange = { start: number; end: number };

/** Char-exact restyling of novel tokens inside changed lines, keyed by side and 1-based line. */
export type SpanEmphasis = {
	rangesFor: (side: DiffSide, lineNumber: number) => readonly EmphasisRange[] | undefined;
	deletionsFg: string;
	additionsFg: string;
};

export interface DiffCell {
	kind: "context" | "addition" | "deletion" | "empty";
	/** Sanitized, tab-expanded source text used for terminal geometry. */
	text: string;
	/** Raw source text without its line ending, retained for paint-range offsets. */
	rawText: string;
	spans: RenderSpan[];
	oldLineNumber?: number;
	newLineNumber?: number;
	/** Tab-adjusted intra-line ranges; paint colours are deliberately not part of geometry. */
	intralineRanges: readonly EmphasisRange[];
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
