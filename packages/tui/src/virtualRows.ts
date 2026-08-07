// Windowed rendering for the review viewport. openTUI's viewportCulling skips
// painting but still mounts and lays out every node, so a large diff pays the
// full Yoga cost on every width change. The viewport is instead planned as a
// flat list of segments (file chrome, diff bodies) whose row heights are known
// up front; only rows near the visible window are mounted and the rest become
// fixed-height gaps, keeping layout work proportional to the screen.

import {
	createDiffFile,
	type DiffChromeWidths,
	type DiffFile,
	type DiffFileInput,
	type DiffLayout,
	type DiffLineRange,
	type DiffMeasurement,
	type DiffSide,
	type DiffVisualPlan,
	diffStructure,
	measureDiff,
	planDiff,
} from "@revue/diff";
import {
	attachmentsForRow,
	type DiffInlineAttachment,
	type ExpandDirection,
} from "@revue/diff-opentui";

export type SegmentRows = {
	id: string;
	heights: readonly number[];
};

export type RowWindow = {
	/** First mounted row index. */
	start: number;
	/** Exclusive end row index. */
	end: number;
};

export type WindowPlanItem =
	| { kind: "gap"; height: number }
	| { kind: "rows"; id: string; window: RowWindow };

export const segmentsHeight = (segments: readonly SegmentRows[]): number =>
	segments.reduce(
		(total, segment) => total + segment.heights.reduce((sum, height) => sum + height, 0),
		0,
	);

/** Absolute offset of a segment's row from the top of the planned content. */
export const segmentOffset = (
	segments: readonly SegmentRows[],
	id: string,
	row = 0,
): number | null => {
	let offset = 0;
	for (const segment of segments) {
		if (segment.id === id) {
			return offset + segment.heights.slice(0, row).reduce((sum, height) => sum + height, 0);
		}
		offset += segment.heights.reduce((sum, height) => sum + height, 0);
	}
	return null;
};

/**
 * The mounted slice of a segment list for one scroll position: rows whose span
 * intersects the window (viewport plus overscan) are kept, everything else is
 * merged into gaps. Total height is preserved exactly, so scroll geometry is
 * indistinguishable from mounting everything.
 */
export const planWindow = ({
	segments,
	scrollTop,
	viewportHeight,
	overscan,
}: {
	segments: readonly SegmentRows[];
	scrollTop: number;
	viewportHeight: number;
	overscan: number;
}): WindowPlanItem[] => {
	const windowStart = Math.max(0, scrollTop - overscan);
	const windowEnd = Math.max(windowStart, scrollTop + viewportHeight + overscan);
	const plan: WindowPlanItem[] = [];
	let gap = 0;
	let y = 0;

	const flushGap = () => {
		if (gap > 0) plan.push({ kind: "gap", height: gap });
		gap = 0;
	};

	for (const segment of segments) {
		let start = -1;
		let end = -1;
		let rowTop = y;
		for (const [index, height] of segment.heights.entries()) {
			const rowBottom = rowTop + height;
			if (start < 0 && rowTop < windowEnd && rowBottom > windowStart) start = index;
			if (start >= 0 && end < 0 && rowTop >= windowEnd) end = index;
			rowTop = rowBottom;
		}
		if (start < 0) {
			gap += rowTop - y;
		} else {
			const stop = end < 0 ? segment.heights.length : end;
			const prefix = segment.heights.slice(0, start).reduce((sum, height) => sum + height, 0);
			const suffix = segment.heights.slice(stop).reduce((sum, height) => sum + height, 0);
			gap += prefix;
			flushGap();
			plan.push({ kind: "rows", id: segment.id, window: { start, end: stop } });
			gap = suffix;
		}
		y = rowTop;
	}
	flushGap();
	return plan;
};

// ── Revue's viewport: file chrome and diff bodies as segments ──────────────

export const OVERSCAN_ROWS = 80;
export const SCROLL_STEP_ROWS = 40;
/** Height assumed for an inline thread until its renderable is measured. */
export const ESTIMATED_ATTACHMENT_HEIGHT = 6;

export const padSegmentId = (path: string) => `pad:${path}`;
export const separatorSegmentId = (path: string) => `sep:${path}`;
export const headerSegmentId = (path: string) => `head:${path}`;
export const notesSegmentId = (path: string) => `notes:${path}`;
export const bodySegmentId = (path: string) => `body:${path}`;
export const segmentKind = (id: string) => id.slice(0, id.indexOf(":"));
export const segmentPath = (id: string) => id.slice(id.indexOf(":") + 1);

export type ViewportFile = {
	path: string;
	/** Absent for a semantic file with notes but no renderable diff. */
	displayed?: DiffFileInput;
	collapsed: boolean;
	separator: boolean;
	/** A blank spacing row above the file, standing in for a flex gap. */
	leadingBlank?: boolean;
	/** One-row-each note lines shown above the body while expanded. */
	noteCount?: number;
	showHunkHeaders?: boolean;
	/** Mirrors the body's own props because visible chrome narrows the wrap budget. */
	showLineNumbers?: boolean;
	showChangeMarkers?: boolean;
	layout: DiffLayout;
	expanderActions?: (boundary: number) => readonly ExpandDirection[];
	resolveRange?: (side: DiffSide, lineNumber: number) => DiffLineRange | null;
};

export type PlannedViewportFile = ViewportFile & {
	/** Exact lightweight geometry used to retain scroll offsets outside the mounted window. */
	measurement?: DiffMeasurement;
	/** Full visual geometry exists only while this body intersects the mounted window. */
	plan?: DiffVisualPlan;
};

type FileGeometryCache = {
	file: DiffFile;
	measurements: Map<string, DiffMeasurement>;
};

const geometryCache = new WeakMap<DiffFileInput, FileGeometryCache>();
const visualPlans = new WeakMap<DiffMeasurement, DiffVisualPlan>();
const GEOMETRY_CACHE_LIMIT = 8;

const geometryKey = ({
	file,
	width,
	chrome,
	syntaxTheme,
}: {
	file: ViewportFile;
	width: number;
	chrome: DiffChromeWidths;
	syntaxTheme?: string;
}) =>
	[
		file.layout,
		width,
		file.showLineNumbers !== false,
		file.showChangeMarkers !== false,
		file.showHunkHeaders !== false,
		syntaxTheme ?? "",
		chrome.focusMarker,
		chrome.attachmentMarker,
		chrome.sign,
		chrome.edge,
		chrome.divider,
		chrome.minimumCode,
	].join(":");

const geometryFor = (file: DiffFileInput): FileGeometryCache => {
	const cached = geometryCache.get(file);
	if (cached) return cached;
	const geometry = { file: createDiffFile(file), measurements: new Map<string, DiffMeasurement>() };
	geometryCache.set(file, geometry);
	return geometry;
};

/** Measure every expanded body without allocating visual cells for off-screen rows. */
export const planViewportFiles = ({
	files,
	width,
	chrome,
	syntaxTheme,
}: {
	files: readonly ViewportFile[];
	width: number;
	chrome: DiffChromeWidths;
	syntaxTheme?: string;
}): PlannedViewportFile[] =>
	files.map((file) => {
		if (!file.displayed || file.collapsed) return file;
		const cache = geometryFor(file.displayed);
		const key = geometryKey({ file, width, chrome, syntaxTheme });
		let measurement = cache.measurements.get(key);
		if (measurement) {
			cache.measurements.delete(key);
			cache.measurements.set(key, measurement);
		}
		if (!measurement) {
			measurement = measureDiff({
				structure: diffStructure({ file: cache.file, layout: file.layout, syntaxTheme }),
				width,
				visibility: {
					lineNumbers: file.showLineNumbers !== false,
					changeMarkers: file.showChangeMarkers !== false,
					hunkHeaders: file.showHunkHeaders !== false,
				},
				chrome,
			});
			cache.measurements.set(key, measurement);
			if (cache.measurements.size > GEOMETRY_CACHE_LIMIT) {
				const oldest = cache.measurements.keys().next().value;
				if (oldest !== undefined) cache.measurements.delete(oldest);
			}
		}
		return { ...file, measurement };
	});

/** Materialise visual rows only for bodies selected by the viewport's overscanned window. */
export const planViewportBodies = ({
	files,
	windowPlan,
}: {
	files: readonly PlannedViewportFile[];
	windowPlan: readonly WindowPlanItem[];
}): PlannedViewportFile[] => {
	const mountedBodies = new Set(
		windowPlan.flatMap((item) =>
			item.kind === "rows" && segmentKind(item.id) === "body" ? [segmentPath(item.id)] : [],
		),
	);
	return files.map((file) => {
		if (!file.measurement || !mountedBodies.has(file.path)) return file;
		let plan = visualPlans.get(file.measurement);
		if (!plan) {
			plan = planDiff({
				structure: file.measurement.structure,
				width: file.measurement.width,
				visibility: file.measurement.visibility,
				chrome: file.measurement.chrome,
			});
			visualPlans.set(file.measurement, plan);
		}
		return { ...file, plan };
	});
};

const bodyHeights = ({
	file,
	attachments,
	attachmentHeight,
}: {
	file: PlannedViewportFile;
	attachments: readonly DiffInlineAttachment[];
	attachmentHeight: (id: string) => number;
}): number[] => {
	const measurement = file.measurement;
	if (!measurement) return [];
	const normalized = measurement.structure.file;
	if (normalized.isTooLarge || normalized.isBinary || !normalized.metadata.hunks.length) return [1];
	const heights = measurement.structure.rows.map((row, index) => {
		const height = measurement.heights[index] ?? 0;
		if (row.type === "hunk-header")
			return height + (file.expanderActions?.(row.hunkIndex)?.length ? 1 : 0);
		const attached = attachmentsForRow({
			row: { structure: measurement.structure, row },
			attachments,
			resolveRange: file.resolveRange,
		});
		return height + attached.reduce((sum, attachment) => sum + attachmentHeight(attachment.id), 0);
	});
	// The trailing expander band occupies a pseudo-row after the measured rows.
	heights.push(file.expanderActions?.(normalized.metadata.hunks.length)?.length ? 1 : 0);
	return heights;
};

/** The row an inline attachment with this anchor renders under, or -1. */
export const attachmentRowIndex = (file: PlannedViewportFile, anchor: DiffLineRange): number => {
	const measurement = file.measurement;
	if (!measurement) return -1;
	const probe = [{ id: "probe", anchor, content: null }];
	return measurement.structure.rows.findIndex(
		(row) =>
			attachmentsForRow({
				row: { structure: measurement.structure, row },
				attachments: probe,
				resolveRange: file.resolveRange,
			}).length > 0,
	);
};

export const viewportSegments = ({
	files,
	attachments,
	attachmentHeight,
}: {
	files: readonly PlannedViewportFile[];
	attachments: readonly DiffInlineAttachment[];
	attachmentHeight: (id: string) => number;
}): SegmentRows[] => {
	const segments: SegmentRows[] = [];
	for (const file of files) {
		if (file.leadingBlank) segments.push({ id: padSegmentId(file.path), heights: [1] });
		if (file.separator) segments.push({ id: separatorSegmentId(file.path), heights: [1] });
		segments.push({ id: headerSegmentId(file.path), heights: [1] });
		if (!file.collapsed) {
			if (file.noteCount) {
				segments.push({
					id: notesSegmentId(file.path),
					heights: Array.from({ length: file.noteCount }, () => 1),
				});
			}
			if (file.measurement) {
				segments.push({
					id: bodySegmentId(file.path),
					heights: bodyHeights({ file, attachments, attachmentHeight }),
				});
			}
		}
	}
	return segments;
};
