// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import {
	type CliRenderer,
	createCliRenderer,
	createTextAttributes,
	type MouseEvent as OpenTUIMouseEvent,
	type ScrollBoxRenderable,
	type TextareaRenderable,
	TextRenderable,
} from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
	anchorRowIndex,
	type DecorationAnchor,
	type DiffFile,
	type DiffFileInput,
	type DiffLineRange,
	type DiffSide,
	type DiffVisualPlan,
	EXCERPT_HUNK_OLD_START,
	type ExcerptQuotation,
	findFocusedDecorationAnchor,
	parsePatch,
	planDiagram,
	planExcerpt,
	prepareSyntaxHighlighting,
	type RangeDecoration,
	type SpanEmphasis,
} from "@revue/diff";
import {
	DiagramBlock,
	DiffBody,
	type DiffBodyProps,
	DiffFileHeader,
	type DiffInlineAttachment,
	decorationAnchorId,
	diffRangeWithin,
	ExcerptBlock,
	type ExpandDirection,
	OPENTUI_DIFF_CHROME,
} from "@revue/diff-opentui";
import {
	type Appearance,
	resolveTheme,
	THEMES,
	type Theme,
	withTransparentSurfaces,
} from "@revue/theme";
import {
	type Chapter,
	type ContextExcerpt,
	emptyViewState,
	excerptKey,
	frozenExcerptContaining,
	frozenExcerptFor,
	isExcerptAnchor,
	narratedUnitCount,
	type Prologue,
	partialDepthLabel,
	type ReviewThread,
	type RevueChaptersFile,
	type RunContextFile,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ThreadMessage,
	type ViewState,
} from "@revue/types";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { copyToClipboard } from "./clipboard.ts";
import { type ChapterDiffFile, type FileStat, selectChapterFiles, statsByPath } from "./diff.ts";
import {
	boundaryActions,
	expandBoundary,
	expandedPatchText,
	type FileExpansion,
} from "./expand.ts";
import type { KeymapIssue } from "./keybindings.ts";
import {
	deriveAppKeys,
	KEYMAP,
	type KeymapAction,
	keymapHint,
	keymapSections,
	matchKeymapAction,
} from "./keymap.ts";
import {
	type DiffLayoutPreference,
	defaultPanelWidth,
	layoutForFile,
	resolveLayout,
	resolvePanelWidth,
	type SidebarPreference,
} from "./layout.ts";
import { Narration, splitNarration } from "./markdown.tsx";
import {
	buildAppMenus,
	ContextMenu,
	MenuBackdrop,
	MenuBar,
	MenuDropdown,
	type MenuEntry,
	nextMenuItemIndex,
	type ReviewSurface,
	selectable,
	useMenuController,
} from "./menu.tsx";
import { type ChapterReference, chapterReferenceCopy } from "./narrationCopy.ts";
import {
	abbreviatePath,
	buildPathTree,
	commonDirPrefix,
	formatDisplayPath,
	nextPathDisplayMode,
	type PathDisplayMode,
	type PathTreeRow,
} from "./pathDisplay.ts";
import type { FileDisplayPreference, Preferences } from "./preferences.ts";
import { useScrollWindow } from "./scrollWindow.ts";
import { type SemanticDiffResult, type SemanticEmphasis, terminalSafe } from "./semantic.ts";
import {
	formatSourceLocation,
	type PermalinkContext,
	permalinkBlocker,
	permalinkFor,
	sourceRangeFor,
} from "./sourceLink.ts";
import { type NarrativeCoverage, StatusBar, type StatusNotice } from "./statusBar.tsx";
import {
	complexityColor,
	severityBackgroundColor,
	severityColor,
	ThemeProvider,
	useTheme,
} from "./theme.ts";
import { ThemePicker, ThemePickerBackdrop } from "./themePicker.tsx";
import { mergeCustomThemes, type ThemeIssue } from "./themes.ts";
import { addThreadReply, createThread, createThreadMessage, sortThreads } from "./threads.ts";
import {
	chapterFilePaths,
	isChapterReviewed,
	isFileReviewed,
	isKeyChangeChecked,
	nextUnreviewedChapter,
	type ReviewSessionState,
	toggleChapter,
	toggleFile,
	toggleKeyChange,
} from "./viewState.ts";
import {
	attachmentRowIndex,
	bodySegmentId,
	ESTIMATED_ATTACHMENT_HEIGHT,
	excerptSegmentId,
	headerSegmentId,
	OVERSCAN_ROWS,
	type PlannedViewportFile,
	planViewportBodies,
	planViewportFiles,
	planWindow,
	SCROLL_STEP_ROWS,
	segmentKind,
	segmentOffset,
	segmentPath,
	type ViewportDiagram,
	type ViewportExcerpt,
	type ViewportFile,
	viewportSegments,
	type WindowPlanItem,
} from "./virtualRows.ts";

const PANEL_INDEX_MAX_ROWS = 8;
/** The chapter viewport scrollbox pads its content by one row. */
const VIEWPORT_TOP_PADDING = 1;

/**
 * Slots pure-custom themes into the picker's list right after the bundled/shadowed entries that
 * share their appearance, mirroring how `revue themes` groups the merged list by appearance,
 * instead of appending them after every bundled theme regardless of appearance.
 */
const orderThemesForPicker = (mergedThemes: readonly Theme[]): Theme[] => {
	const bundledAndShadowed = mergedThemes.slice(0, THEMES.length);
	const pureCustom = mergedThemes.slice(THEMES.length);
	const ordered = [...bundledAndShadowed];
	for (const theme of pureCustom) {
		let insertAt = ordered.length;
		for (let index = ordered.length - 1; index >= 0; index--) {
			if (ordered[index]?.appearance === theme.appearance) {
				insertAt = index + 1;
				break;
			}
		}
		ordered.splice(insertAt, 0, theme);
	}
	return ordered;
};

/**
 * Scrolls a row offset (relative to the windowed content) into view. The target
 * may sit inside an unmounted gap, so this stands in for scrollChildIntoView
 * wherever the window plan owns the target; a delayed scrollChildIntoView
 * afterwards fine-tunes once the target mounts.
 */
const revealContentOffset = ({
	scroll,
	leadingHeight,
	offset,
	span = 1,
}: {
	scroll: ScrollBoxRenderable | null;
	leadingHeight: number;
	offset: number;
	span?: number;
}) => {
	if (!scroll) return;
	const top = offset + leadingHeight + VIEWPORT_TOP_PADDING;
	const viewportHeight = scroll.viewport.height;
	if (top < scroll.scrollTop) scroll.scrollTo(top);
	else if (top + span > scroll.scrollTop + viewportHeight) {
		scroll.scrollTo(Math.max(0, top + span - viewportHeight));
	}
};

const centreContentOffset = ({
	scroll,
	leadingHeight,
	offset,
	span = 1,
}: {
	scroll: ScrollBoxRenderable | null;
	leadingHeight: number;
	offset: number;
	span?: number;
}) => {
	if (!scroll) return;
	const top = offset + leadingHeight + VIEWPORT_TOP_PADDING;
	const maximum = Math.max(0, scroll.scrollHeight - scroll.viewport.height);
	const centred = top - Math.floor((scroll.viewport.height - span) / 2);
	scroll.scrollTo(Math.max(0, Math.min(centred, maximum)));
};
const RIGHT_MOUSE_BUTTON = 2;
const COMPACT_NAV_WIDTH = 34;
const COMPACT_STRIP_WIDTH = 60;
// ── Page model ──────────────────────────────────────────────────────────────
// The reviewer pages through one "beat" at a time: an optional prologue, then
// each chapter in order. This is the core Stage UX, so we own it here and
// compose the Revue renderer's file header and body into collapsible sections.

type Page =
	| { kind: "prologue"; label: string; prologue: Prologue }
	| { kind: "chapter"; label: string; chapter: Chapter }
	| { kind: "files"; label: string; chapter: Chapter }
	| { kind: "comments"; label: string };

export const ALL_FILES_CHAPTER_ID = "__files__";
const ALL_FILES_LABEL = "All files";
const COMMENTS_PAGE_ID = "__comments__";
const COMMENTS_PAGE: Page = { kind: "comments", label: "Comments" };
const INTERLUDE_GLYPH = "¶";
const INTERLUDE_NOTE = `${INTERLUDE_GLYPH} interlude`;
const INTERLUDE_CLOSE = "── end of chapter ──";

/**
 * A prose-only page: a chapter that cites no review units. The synthetic Files
 * chapter never counts, since an empty diff is not a narrative choice.
 */
const isInterlude = (chapter: Chapter) =>
	chapter.id !== ALL_FILES_CHAPTER_ID && chapter.hunkRefs.length === 0;

/** The whole diff as one synthetic chapter, so the flat page reuses the chapter pipeline. */
const allFilesChapter = (diffFiles: DiffFile[] | null, order: number): Chapter => ({
	id: ALL_FILES_CHAPTER_ID,
	order,
	title: ALL_FILES_LABEL,
	summary: "",
	hunkRefs: (diffFiles ?? []).flatMap((file) => {
		const path = file.path ?? file.metadata.name;
		return file.metadata.hunks.length
			? file.metadata.hunks.map((hunk) => ({ filePath: path, oldStart: hunk.deletionStart }))
			: [{ filePath: path, oldStart: 0 }];
	}),
	keyChanges: [],
	excerpts: [],
});

function buildPages(file: RevueChaptersFile): Page[] {
	const pages: Page[] = [];
	if (file.prologue) {
		pages.push({ kind: "prologue", label: "Prologue", prologue: file.prologue });
	}
	for (const chapter of [...file.chapters].sort((a, b) => a.order - b.order)) {
		pages.push({ kind: "chapter", label: chapter.title, chapter });
	}
	return pages;
}

const pageId = (page: Page | undefined) => {
	if (!page || page.kind === "prologue") return "prologue";
	return page.kind === "comments" ? COMMENTS_PAGE_ID : page.chapter.id;
};

const emptyReviewPageState = () => ({
	selectedFile: 0,
	selectedHunk: 0,
	selectedKeyChange: 0,
	collapsedFiles: [] as string[],
	openExcerpts: [] as string[],
	foldedDiagrams: [] as string[],
	scrollTop: 0,
	panelScrollTop: 0,
});

/**
 * Excerpts sit in narration order rather than being pinned to the end of a chapter: the nth
 * citation follows the nth file section, and any citation past the last file closes the chapter.
 * A chapter with no files — an interlude — leads with them.
 */
const excerptAnchor = (paths: readonly string[], index: number): string | null =>
	paths.length ? (paths[Math.min(index, paths.length - 1)] ?? null) : null;

/** Fold keys for figures, namespaced away from excerpt keys, which are cited ranges. */
const diagramFoldKey = (chapterId: string, index: number) => `diagram:${chapterId}:${index}`;

type ChapterFocusTarget = { kind: "file"; index: number } | { kind: "excerpt"; key: string };

/** Distinct citations in declared order; a repeated range is one block, opened once. */
const distinctExcerpts = (chapter: Chapter): { key: string; excerpt: ContextExcerpt }[] => {
	const seen = new Set<string>();
	return chapter.excerpts.flatMap((excerpt) => {
		const key = excerptKey(excerpt);
		if (seen.has(key)) return [];
		seen.add(key);
		return [{ key, excerpt }];
	});
};

/** Whether a quotation is the one a range was dragged over, so tint and yank agree. */
const excerptCovers = (quotation: ExcerptQuotation, range: DiffLineRange): boolean =>
	quotation.filePath === range.filePath &&
	quotation.startLine <= range.startLine &&
	range.endLine <= quotation.endLine;

/**
 * The frozen lines a selected range covers. The quotation is the only source: an excerpt may
 * cite a file the diff never touched, so neither the manifest nor the parsed patch can answer.
 */
const excerptRangeText = (
	excerpts: readonly ViewportExcerpt[],
	range: DiffLineRange,
): string | null => {
	const quotation = excerpts
		.map((excerpt) => excerpt.plan.quotation)
		.find((candidate) => excerptCovers(candidate, range));
	if (!quotation) return null;
	const from = range.startLine - quotation.startLine;
	const lines = quotation.lines.slice(from, from + (range.endLine - range.startLine) + 1);
	return lines.length ? lines.join("\n") : null;
};

const pageRowId = (index: number) => `page-index-row:${index}`;

function PageIndexRows({
	pages,
	current,
	vs,
	onSelect,
}: {
	pages: Page[];
	current: number;
	vs: ViewState;
	onSelect: (index: number) => void;
}) {
	const theme = useTheme();
	return pages.map((page, index) => {
		const active = index === current;
		const done = page.kind === "chapter" && isChapterReviewed(vs, page.chapter.id);
		const glyph = page.kind === "chapter" && isInterlude(page.chapter) ? `${INTERLUDE_GLYPH} ` : "";
		const label =
			page.kind === "chapter" ? `${glyph}${page.chapter.order}. ${page.label}` : page.label;
		return (
			<box
				key={page.label}
				id={pageRowId(index)}
				height={1}
				width="100%"
				flexDirection="row"
				backgroundColor={active ? theme.panelAlt : undefined}
				onMouseDown={() => onSelect(index)}
			>
				<text flexShrink={0} fg={active ? theme.accent : theme.panelAlt}>
					{active ? "▸" : " "}
				</text>
				<text flexShrink={0} fg={done ? theme.badgeAdded : theme.muted}>
					{page.kind !== "prologue" ? `[${done ? "x" : " "}] ` : "    "}
				</text>
				<text
					flexGrow={1}
					minWidth={0}
					wrapMode="none"
					truncate
					fg={active ? theme.accent : done ? theme.badgeAdded : theme.muted}
				>
					{label}
				</text>
			</box>
		);
	});
}

/** Every page at a glance; scrolls itself once a review runs past a screenful. */
function PageIndex({
	pages,
	current,
	vs,
	onSelect,
	scrollRef,
}: {
	pages: Page[];
	current: number;
	vs: ViewState;
	onSelect: (index: number) => void;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
	const theme = useTheme();
	const rows = <PageIndexRows pages={pages} current={current} vs={vs} onSelect={onSelect} />;
	if (pages.length <= PANEL_INDEX_MAX_ROWS) {
		return (
			<box flexDirection="column" flexShrink={0} width="100%" paddingLeft={1}>
				{rows}
			</box>
		);
	}
	return (
		<scrollbox
			ref={scrollRef}
			height={PANEL_INDEX_MAX_ROWS}
			flexShrink={0}
			width="100%"
			paddingLeft={1}
			scrollY
			verticalScrollbarOptions={{ trackOptions: { foregroundColor: theme.border } }}
		>
			{rows}
		</scrollbox>
	);
}

function NavButton({
	label,
	enabled,
	onPress,
}: {
	label: string;
	enabled: boolean;
	onPress: () => void;
}) {
	const theme = useTheme();
	return (
		<box
			height={1}
			flexShrink={0}
			backgroundColor={enabled ? theme.panelAlt : undefined}
			onMouseDown={(event) => {
				event.stopPropagation();
				if (enabled) onPress();
			}}
		>
			<text fg={enabled ? theme.accent : theme.muted}>{` ${label} `}</text>
		</box>
	);
}

/** Stands in for the panel's own navigation row on terminals too narrow for it. */
function PageNavStrip({
	page,
	pages,
	current,
	chapterCount,
	width,
	vs,
	onNavigatePage,
	onToggleChapterReview,
}: {
	page: Page | undefined;
	pages: Page[];
	current: number;
	chapterCount: number;
	width: number;
	vs: ViewState;
	onNavigatePage: (index: number) => void;
	onToggleChapterReview: () => void;
}) {
	const theme = useTheme();
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	// The Files surface is outside the page sequence, so it gets no Prev/Next.
	const filesSurface = page?.kind === "files";
	const chapterReviewed = chapter ? isChapterReviewed(vs, chapter.id) : false;
	const compact = width < COMPACT_STRIP_WIDTH;
	return (
		<box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
			{filesSurface ? null : (
				<NavButton
					label={compact ? "◀" : "◀ Prev"}
					enabled={current > 0}
					onPress={() => onNavigatePage(current - 1)}
				/>
			)}
			<box flexGrow={1} minWidth={0} flexDirection="row" justifyContent="center">
				{chapter ? (
					<text
						flexShrink={0}
						fg={chapterReviewed ? theme.badgeAdded : theme.muted}
						onMouseDown={onToggleChapterReview}
					>
						[{chapterReviewed ? "x" : " "}]{" "}
					</text>
				) : null}
				<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text}>
					{chapter ? `Chapter ${chapter.order}/${chapterCount}` : (page?.label ?? "")}
				</text>
			</box>
			{filesSurface ? null : (
				<NavButton
					label={compact ? "▶" : "Next ▶"}
					enabled={current < pages.length - 1}
					onPress={() => onNavigatePage(current + 1)}
				/>
			)}
		</box>
	);
}

/**
 * The chapter's narrative. It reads the same in the side panel or stacked above
 * the diff, so a terminal too narrow for two columns loses the layout, not the
 * story.
 */
function ChapterBrief({
	chapter,
	vs,
	selectedFile,
	selectedKeyChange,
	stats,
	pathDisplay,
	width,
	onSelectFile,
	onFocusKeyChange,
	onToggleFileReview,
	onToggleKeyChange,
	onProseContextMenu,
}: {
	chapter: Chapter;
	vs: ViewState;
	selectedFile: number;
	selectedKeyChange: number;
	stats: Map<string, FileStat>;
	pathDisplay: PathDisplayMode;
	width: number;
	onSelectFile: (index: number) => void;
	onFocusKeyChange: (index: number) => void;
	onToggleFileReview: (path: string) => void;
	onToggleKeyChange: (index: number) => void;
	/** Absent where the narration belongs to no real chapter, such as the Files surface. */
	onProseContextMenu?: (reference: ChapterReference, position: { x: number; y: number }) => void;
}) {
	const theme = useTheme();
	const proseMenu = onProseContextMenu
		? (event: OpenTUIMouseEvent) => {
				if (event.button !== RIGHT_MOUSE_BUTTON) return;
				event.preventDefault();
				event.stopPropagation();
				onProseContextMenu(
					{ order: chapter.order, title: chapter.title },
					{ x: event.x, y: event.y },
				);
			}
		: undefined;
	// Diagrams are hoisted out of the summary: they render in the content column, where the
	// window plan can give them a height, rather than inside the brief.
	const prose = splitNarration(chapter.summary).prose;
	if (isInterlude(chapter)) {
		return (
			<box flexDirection="column" width="100%" gap={1}>
				<box flexDirection="column" width="100%">
					<text fg={theme.accent}>{chapter.title}</text>
					<text fg={theme.muted}>{INTERLUDE_NOTE}</text>
				</box>
				{prose ? <Narration text={prose} fg={theme.muted} onMouseDown={proseMenu} /> : null}
			</box>
		);
	}
	return (
		<box flexDirection="column" width="100%" gap={1}>
			<text fg={theme.accent}>{chapter.title}</text>
			{prose ? <Narration text={prose} fg={theme.muted} onMouseDown={proseMenu} /> : null}
			<KeyChanges
				chapter={chapter}
				vs={vs}
				selected={selectedKeyChange}
				onFocus={onFocusKeyChange}
				onToggle={onToggleKeyChange}
			/>
			<FileList
				chapter={chapter}
				vs={vs}
				selected={selectedFile}
				stats={stats}
				pathDisplay={pathDisplay}
				width={width}
				onSelect={onSelectFile}
				onToggleReview={onToggleFileReview}
			/>
		</box>
	);
}

function ChapterPanel({
	page,
	pages,
	current,
	chapterCount,
	coverage,
	omittedNotice,
	width,
	vs,
	indexExpanded,
	selectedFile,
	selectedKeyChange,
	stats,
	pathDisplay,
	onNavigatePage,
	onToggleIndex,
	onResizeStart,
	onSelectFile,
	onFocusKeyChange,
	indexScrollRef,
	scrollRef,
	onToggleChapterReview,
	onToggleFileReview,
	onToggleKeyChange,
	onProseContextMenu,
}: {
	page: Page | undefined;
	pages: Page[];
	current: number;
	chapterCount: number;
	coverage: NarrativeCoverage | null;
	omittedNotice: string | null;
	width: number;
	vs: ViewState;
	indexExpanded: boolean;
	selectedFile: number;
	selectedKeyChange: number;
	stats: Map<string, FileStat>;
	pathDisplay: PathDisplayMode;
	onNavigatePage: (index: number) => void;
	onToggleIndex: () => void;
	onResizeStart: (event: OpenTUIMouseEvent) => void;
	onSelectFile: (index: number) => void;
	onFocusKeyChange: (index: number) => void;
	indexScrollRef: RefObject<ScrollBoxRenderable | null>;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	onToggleChapterReview: () => void;
	onToggleFileReview: (path: string) => void;
	onToggleKeyChange: (index: number) => void;
	onProseContextMenu: (reference: ChapterReference, position: { x: number; y: number }) => void;
}) {
	const theme = useTheme();
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const briefChapter = page?.kind === "chapter" || page?.kind === "files" ? page.chapter : null;
	// The Files surface deliberately drops all story chrome so it reads as its own screen.
	const filesSurface = page?.kind === "files";
	const chapterReviewed = chapter ? isChapterReviewed(vs, chapter.id) : false;
	const compact = width < COMPACT_NAV_WIDTH;
	const rule = "─".repeat(Math.max(1, width - 1));

	return (
		<box
			border={["right"]}
			borderColor={theme.border}
			flexDirection="column"
			width={width}
			flexShrink={0}
			onMouseDown={(event) => {
				if (event.x === width - 1) onResizeStart(event);
			}}
		>
			<box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
				<text flexShrink={0} fg={theme.accent}>
					revue
				</text>
			</box>
			{chapterCount > 0 && !filesSurface ? (
				<box
					flexDirection="row"
					height={1}
					flexShrink={0}
					paddingLeft={1}
					paddingRight={1}
					onMouseDown={onToggleIndex}
				>
					<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.heading}>
						{indexExpanded ? "▾" : "▸"} Chapters ({chapterCount})
						{coverage ? ` · ${coverage.label}` : ""}
					</text>
				</box>
			) : null}
			{chapterCount > 0 && !filesSurface && coverage ? (
				<box flexDirection="row" height={1} flexShrink={0} paddingLeft={4} paddingRight={1}>
					<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.muted}>
						{`${coverage.narrated} of ${coverage.total} hunks · rest in Files`}
					</text>
				</box>
			) : null}
			{/* Unlike coverage, an omission applies at every depth: the run itself is short. */}
			{omittedNotice ? (
				<box flexDirection="row" height={1} flexShrink={0} paddingLeft={4} paddingRight={1}>
					<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.muted}>
						{omittedNotice}
					</text>
				</box>
			) : null}
			{chapterCount > 0 && !filesSurface && indexExpanded ? (
				<PageIndex
					pages={pages}
					current={current}
					vs={vs}
					onSelect={onNavigatePage}
					scrollRef={indexScrollRef}
				/>
			) : null}
			{pages.length > 1 && !filesSurface ? (
				<>
					<text flexShrink={0} fg={theme.border}>
						{rule}
					</text>
					<box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
						<NavButton
							label={compact ? "◀" : "◀ Prev"}
							enabled={current > 0}
							onPress={() => onNavigatePage(current - 1)}
						/>
						<box flexGrow={1} minWidth={0} flexDirection="row" justifyContent="center">
							{chapter ? (
								<text
									flexShrink={0}
									fg={chapterReviewed ? theme.badgeAdded : theme.muted}
									onMouseDown={onToggleChapterReview}
								>
									[{chapterReviewed ? "x" : " "}]{" "}
								</text>
							) : null}
							<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text}>
								{chapter ? `Chapter ${chapter.order}/${chapterCount}` : (page?.label ?? "")}
							</text>
						</box>
						<NavButton
							label={compact ? "▶" : "Next ▶"}
							enabled={current < pages.length - 1}
							onPress={() => onNavigatePage(current + 1)}
						/>
					</box>
				</>
			) : null}
			{briefChapter ? (
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					flexShrink={1}
					minHeight={0}
					padding={1}
					scrollY
					viewportCulling
				>
					<ChapterBrief
						chapter={briefChapter}
						vs={vs}
						selectedFile={selectedFile}
						selectedKeyChange={selectedKeyChange}
						stats={stats}
						pathDisplay={pathDisplay}
						width={Math.max(20, width - 4)}
						onSelectFile={onSelectFile}
						onFocusKeyChange={onFocusKeyChange}
						onToggleFileReview={onToggleFileReview}
						onToggleKeyChange={onToggleKeyChange}
						onProseContextMenu={filesSurface ? undefined : onProseContextMenu}
					/>
				</scrollbox>
			) : (
				<box flexGrow={1} flexShrink={1} minHeight={0} />
			)}
		</box>
	);
}

// ── Prologue ────────────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
	const theme = useTheme();
	return (
		<text flexShrink={0} fg={theme.background} bg={color}>
			{` ${label} `}
		</text>
	);
}

/** A marker column plus a flexible body, so wrapped lines keep a hanging indent. */
function Hanging({
	marker,
	markerColor,
	children,
}: {
	marker: string;
	markerColor: string;
	children: ReactNode;
}) {
	return (
		<box flexDirection="row" width="100%">
			<text flexShrink={0} fg={markerColor}>
				{marker}
			</text>
			<box flexDirection="column" flexGrow={1} minWidth={0}>
				{children}
			</box>
		</box>
	);
}

function PrologueSection({
	title,
	gap = 1,
	children,
}: {
	title: string;
	gap?: number;
	children: ReactNode;
}) {
	const theme = useTheme();
	return (
		<box flexDirection="column" width="100%">
			<text fg={theme.heading} attributes={createTextAttributes({ bold: true })}>
				{title.toUpperCase()}
			</text>
			<box flexDirection="column" width="100%" gap={gap} paddingTop={1}>
				{children}
			</box>
		</box>
	);
}

function PrologueChapters({
	pages,
	vs,
	onSelectPage,
}: {
	pages: Page[];
	vs: ViewState;
	onSelectPage: (index: number) => void;
}) {
	const theme = useTheme();
	return pages.flatMap((page, index) =>
		page.kind === "chapter"
			? [
					<box
						key={page.chapter.id}
						height={1}
						width="100%"
						flexDirection="row"
						onMouseDown={() => onSelectPage(index)}
					>
						<text
							flexShrink={0}
							fg={isChapterReviewed(vs, page.chapter.id) ? theme.badgeAdded : theme.muted}
						>
							{`[${isChapterReviewed(vs, page.chapter.id) ? "x" : " "}] ${page.chapter.order}. `}
						</text>
						<text flexGrow={1} minWidth={0} wrapMode="none" truncate fg={theme.accent}>
							{page.chapter.title}
						</text>
					</box>,
				]
			: [],
	);
}

function PrologueView({
	prologue,
	pages,
	vs,
	onSelectPage,
	onSelectFocusArea,
}: {
	prologue: Prologue;
	pages: Page[];
	vs: ViewState;
	onSelectPage: (index: number) => void;
	onSelectFocusArea: (locations: string[]) => void;
}) {
	const theme = useTheme();
	return (
		<box flexDirection="column" width="100%" gap={1}>
			{prologue.motivation ? <Narration text={prologue.motivation} fg={theme.text} /> : null}
			{prologue.outcome ? (
				<Hanging marker="→ " markerColor={theme.badgeAdded}>
					<Narration text={prologue.outcome} fg={theme.badgeAdded} />
				</Hanging>
			) : null}
			<box flexDirection="row" width="100%">
				<Badge
					label={`complexity ${prologue.complexity.level}`}
					color={complexityColor(theme, prologue.complexity.level)}
				/>
				<box flexGrow={1} minWidth={0} paddingLeft={1}>
					<Narration text={prologue.complexity.reasoning} fg={theme.muted} />
				</box>
			</box>

			{prologue.keyChanges.length ? (
				<PrologueSection title="What changed">
					{prologue.keyChanges.map((kc) => (
						<Hanging key={kc.summary} marker="• " markerColor={theme.accent}>
							<Narration text={kc.summary} fg={theme.text} />
							<Narration text={kc.description} fg={theme.muted} />
						</Hanging>
					))}
				</PrologueSection>
			) : null}

			{prologue.focusAreas.length ? (
				<PrologueSection title="Worth a look">
					{prologue.focusAreas.map((fa) => (
						<box
							key={fa.title}
							flexDirection="column"
							width="100%"
							onMouseDown={() => onSelectFocusArea(fa.locations)}
						>
							<box flexDirection="row" width="100%">
								<Badge
									label={fa.severity.toUpperCase()}
									color={severityColor(theme, fa.severity)}
								/>
								<text flexShrink={0} fg={theme.muted}>
									{` ${fa.type} `}
								</text>
								<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text}>
									{fa.title}
								</text>
							</box>
							<box paddingLeft={2} width="100%">
								<Narration text={fa.description} fg={theme.muted} />
							</box>
						</box>
					))}
				</PrologueSection>
			) : null}

			{prologue.diagram ? (
				<box flexDirection="column" border borderColor={theme.border} title=" diagram (mermaid) ">
					<text fg={theme.muted}>{prologue.diagram}</text>
				</box>
			) : null}

			<PrologueSection title="Chapters" gap={0}>
				<PrologueChapters pages={pages} vs={vs} onSelectPage={onSelectPage} />
			</PrologueSection>
		</box>
	);
}

// ── Chapter file list (review state belongs to Revue's shell) ─────────────────
const FILE_ROW_CHROME = 5; // marker column plus "[x] "

const fileRowLabelWidth = (width: number, stat: FileStat | undefined): number => {
	const statsWidth = stat ? `+${stat.additions} -${stat.deletions}`.length + 1 : 0;
	return Math.max(1, width - FILE_ROW_CHROME - statsWidth);
};

function FileRow({
	path,
	label,
	done,
	active,
	stat,
	onSelect,
	onToggleReview,
}: {
	path: string;
	label: string;
	done: boolean;
	active: boolean;
	stat: FileStat | undefined;
	onSelect: () => void;
	onToggleReview: (path: string) => void;
}) {
	const theme = useTheme();
	return (
		<box flexDirection="row" width="100%" height={1}>
			<text flexShrink={0} fg={active ? theme.accent : theme.panelAlt}>
				{active ? "▸" : " "}
			</text>
			<text
				flexShrink={0}
				fg={done ? theme.badgeAdded : theme.muted}
				onMouseDown={() => onToggleReview(path)}
			>
				{`[${done ? "x" : " "}] `}
			</text>
			<text
				flexGrow={1}
				flexShrink={1}
				minWidth={0}
				fg={active ? theme.accent : done ? theme.badgeAdded : theme.muted}
				wrapMode="none"
				truncate
				onMouseDown={onSelect}
			>
				{label}
			</text>
			{stat ? (
				<text flexShrink={0} paddingLeft={1}>
					<span fg={theme.badgeAdded}>+{stat.additions}</span>
					<span> </span>
					<span fg={theme.badgeRemoved}>-{stat.deletions}</span>
				</text>
			) : null}
		</box>
	);
}

function FileList({
	chapter,
	vs,
	selected,
	stats,
	pathDisplay,
	width,
	onSelect,
	onToggleReview,
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	stats: Map<string, FileStat>;
	pathDisplay: PathDisplayMode;
	width: number;
	onSelect: (index: number) => void;
	onToggleReview: (path: string) => void;
}) {
	const theme = useTheme();
	const paths = chapterFilePaths(chapter);
	const prefix = pathDisplay === "smart" ? commonDirPrefix(paths) : "";
	const rows =
		pathDisplay === "tree"
			? buildPathTree(paths)
			: paths.map(
					(path): PathTreeRow => ({
						kind: "file",
						depth: 0,
						label: pathDisplay === "smart" ? path.slice(prefix.length) : path,
						path,
					}),
				);
	return (
		<box flexDirection="column">
			<text fg={theme.heading} wrapMode="none" truncate>
				Files ({paths.length}){prefix ? <span fg={theme.muted}> · in {prefix}</span> : null}
			</text>
			{rows.map((row) => {
				const indent = "  ".repeat(row.depth);
				if (row.kind === "dir") {
					return (
						<text key={`dir:${row.depth}:${row.label}`} fg={theme.muted} wrapMode="none" truncate>
							{`     ${indent}${row.label}`}
						</text>
					);
				}
				const index = paths.indexOf(row.path);
				const stat = stats.get(row.path);
				const bare = `${indent}${row.label}`;
				const label =
					pathDisplay === "smart"
						? abbreviatePath({ path: bare, width: fileRowLabelWidth(width, stat) })
						: bare;
				return (
					<FileRow
						key={row.path}
						path={row.path}
						label={label}
						done={isFileReviewed(vs, chapter.id, row.path)}
						active={index === selected}
						stat={stat}
						onSelect={() => onSelect(index)}
						onToggleReview={onToggleReview}
					/>
				);
			})}
		</box>
	);
}

// ── Chapter key changes (checkable) ───────────────────────────────────────────
const keyChangeId = (chapterId: string, index: number) =>
	`chapter-key-change:${chapterId}:${index}`;

type KeyChangeTarget = {
	fileIndex: number;
	hunkIndex: number;
	anchorId: string;
	anchor: DecorationAnchor;
};

const findKeyChangeTarget = ({
	chapter,
	diffFiles,
	index,
}: {
	chapter: Chapter;
	diffFiles: DiffFile[];
	index: number;
}): KeyChangeTarget | null => {
	const refs = chapter.keyChanges[index]?.lineRefs ?? [];
	const selectedFiles = selectChapterFiles(chapter, diffFiles);
	for (const [refIndex, ref] of refs.entries()) {
		const fileIndex = chapterFilePaths(chapter).indexOf(ref.filePath);
		const file = selectedFiles.find((candidate) => candidate.chapterPath === ref.filePath);
		if (fileIndex < 0 || !file) continue;
		const focusId = `key-change:${chapter.id}:${index}`;
		const anchor = findFocusedDecorationAnchor(
			file,
			[{ ...ref, id: `${focusId}:${refIndex}`, focusId }],
			focusId,
		);
		if (anchor) {
			return {
				fileIndex,
				hunkIndex: anchor.hunkIndex,
				anchorId: decorationAnchorId(anchor),
				anchor,
			};
		}
	}
	return null;
};

type FocusAreaTarget = {
	pageIndex: number;
	chapter: Chapter;
	path: string;
	fileIndex: number;
	keyChangeIndex?: number;
};

const findFocusAreaTarget = (pages: Page[], locations: string[]): FocusAreaTarget | null => {
	const candidates = pages.flatMap((page, pageIndex) =>
		page.kind === "chapter" ? [{ pageIndex, chapter: page.chapter }] : [],
	);
	const anchored = locations.flatMap((path) =>
		candidates.flatMap(({ pageIndex, chapter }) => {
			const keyChangeIndex = chapter.keyChanges.findIndex((keyChange) =>
				keyChange.lineRefs.some((ref) => ref.filePath === path),
			);
			const fileIndex = chapterFilePaths(chapter).indexOf(path);
			return keyChangeIndex >= 0 && fileIndex >= 0
				? [{ pageIndex, chapter, path, fileIndex, keyChangeIndex }]
				: [];
		}),
	)[0];
	if (anchored) return anchored;
	return (
		locations.flatMap((path) =>
			candidates.flatMap(({ pageIndex, chapter }) => {
				const fileIndex = chapterFilePaths(chapter).indexOf(path);
				return fileIndex >= 0 ? [{ pageIndex, chapter, path, fileIndex }] : [];
			}),
		)[0] ?? null
	);
};

const semanticViewportFiles = ({
	chapter,
	semantic,
	fileDisplay,
	selectedFile,
	collapsedFiles,
	diffPreference,
	splitFits,
	diffFiles,
}: {
	chapter: Chapter | null;
	semantic: PreparedSemantic | null;
	fileDisplay: FileDisplayPreference;
	selectedFile: number;
	collapsedFiles: Set<string>;
	diffPreference: DiffLayoutPreference;
	splitFits: boolean;
	diffFiles: DiffFile[] | null;
}): ViewportFile[] => {
	if (!chapter || !semantic) return [];
	const paths = chapterFilePaths(chapter);
	const visible = fileDisplay === "focused" ? paths.slice(selectedFile, selectedFile + 1) : paths;
	return visible.flatMap((path, index) => {
		const semanticFile = semantic.files.find((candidate) => candidate.path === path);
		if (!semanticFile) return [];
		return [
			{
				path,
				displayed: semanticFile.file ?? undefined,
				collapsed: collapsedFiles.has(path),
				separator: index > 0,
				leadingBlank: true,
				noteCount: semanticFile.notes.length,
				showHunkHeaders: false,
				layout: semanticFile.file
					? layoutForFile({ file: semanticFile.file, preference: diffPreference, splitFits })
					: ("stack" as const),
				resolveRange: diffFiles ? gitRangeResolver(diffFiles, path) : undefined,
			},
		];
	});
};

/**
 * The display range an anchor acts on. Quoted code has no old side and belongs to no git hunk,
 * so it borrows the excerpt sentinel the renderer already uses for a quoted line's own range.
 */
const diffRangeForAnchor = (anchor: ThreadAnchor): DiffLineRange =>
	isExcerptAnchor(anchor)
		? {
				filePath: anchor.filePath,
				hunkOldStart: EXCERPT_HUNK_OLD_START,
				side: "additions",
				startLine: anchor.startLine,
				endLine: anchor.endLine,
			}
		: {
				filePath: anchor.filePath,
				hunkOldStart: anchor.oldStart,
				side: anchor.side,
				startLine: anchor.startLine,
				endLine: anchor.endLine,
			};

const threadAnchorRange = (thread: ReviewThread | undefined): DiffLineRange | undefined =>
	thread ? diffRangeForAnchor(thread.anchor) : undefined;

/** The chapter citation whose quoted range contains this thread's anchor, if it has one. */
const citationFor = (chapter: Chapter, { anchor }: ReviewThread): ContextExcerpt | undefined =>
	isExcerptAnchor(anchor)
		? chapter.excerpts.find(
				(excerpt) =>
					excerpt.filePath === anchor.filePath &&
					excerpt.startLine <= anchor.startLine &&
					anchor.endLine <= excerpt.endLine,
			)
		: undefined;

/** A chapter owns a thread through the review unit it narrates or the range it quotes. */
const chapterOwnsThread = (chapter: Chapter, thread: ReviewThread): boolean => {
	const { anchor } = thread;
	if (isExcerptAnchor(anchor)) return citationFor(chapter, thread) !== undefined;
	return chapter.hunkRefs.some(
		(reference) => reference.filePath === anchor.filePath && reference.oldStart === anchor.oldStart,
	);
};

/** Threads on quoted code this chapter cites; they render inside its excerpt block, not a diff. */
const chapterExcerptThreads = (
	chapter: Chapter,
	threads: readonly ReviewThread[],
): ReviewThread[] =>
	threads.filter((thread) => isExcerptAnchor(thread.anchor) && chapterOwnsThread(chapter, thread));

/** Threads on this chapter's own review units. */
const chapterHunkThreads = (chapter: Chapter, threads: readonly ReviewThread[]): ReviewThread[] =>
	threads.filter((thread) => !isExcerptAnchor(thread.anchor) && chapterOwnsThread(chapter, thread));

function KeyChanges({
	chapter,
	vs,
	selected,
	onFocus,
	onToggle,
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	onFocus: (index: number) => void;
	onToggle: (index: number) => void;
}) {
	const theme = useTheme();
	if (!chapter.keyChanges.length) return null;
	return (
		<box flexDirection="column">
			<text fg={theme.badgeModified}>What to review</text>
			{chapter.keyChanges.map((kc, i) => {
				const checked = isKeyChangeChecked(vs, chapter.id, i);
				const active = i === selected;
				return (
					<box id={keyChangeId(chapter.id, i)} key={kc.content} flexDirection="row" width="100%">
						<text flexShrink={0} fg={active ? theme.accent : theme.panelAlt}>
							{active ? "▸" : " "}
						</text>
						<text
							flexShrink={0}
							fg={checked ? theme.badgeAdded : theme.muted}
							onMouseDown={(event) => {
								event.stopPropagation();
								onToggle(i);
							}}
						>
							{`[${checked ? "x" : " "}] `}
						</text>
						<box flexGrow={1} minWidth={0} onMouseDown={() => onFocus(i)}>
							<Narration
								prefix={
									<>
										<span fg={theme.background} bg={severityColor(theme, kc.severity)}>
											{` ${kc.severity.toUpperCase()} `}
										</span>
										<span>{` ${i + 1}. `}</span>
									</>
								}
								text={kc.content}
								fg={active ? theme.accent : checked ? theme.badgeAdded : theme.text}
							/>
						</box>
					</box>
				);
			})}
		</box>
	);
}

// ── Chapter detail ────────────────────────────────────────────────────────────
type ThreadActions = {
	create(anchor: ThreadAnchor, author: ThreadAuthor, body: string): ReviewThread;
	reply(threadId: string, author: ThreadAuthor, body: string): ReviewThread;
	delete(threadId: string): ReviewThread;
	deleteMessage(threadId: string, messageId: string): ThreadMessage;
	markDealt(threadId: string): ReviewThread;
	reopen(threadId: string): ReviewThread;
};

function ThreadMessageView({
	message,
	dealtWith,
	canDelete,
	onDelete,
}: {
	message: ThreadMessage;
	dealtWith: boolean;
	canDelete: boolean;
	onDelete: (messageId: string) => void;
}) {
	const theme = useTheme();
	const agent = message.author.kind === THREAD_AUTHOR_KIND.AGENT;
	return (
		<box flexDirection="column">
			<box flexDirection="row">
				<text fg={agent ? theme.heading : theme.accent}>{agent ? "Agent" : "Human"}</text>
				<text fg={theme.muted}> · </text>
				<text
					fg={dealtWith ? theme.muted : theme.text}
					attributes={createTextAttributes({ bold: true })}
				>
					{message.author.name}
				</text>
				{canDelete ? (
					<>
						<box flexGrow={1} />
						<text
							fg={theme.badgeRemoved}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onDelete(message.id);
							}}
						>
							[Delete]
						</text>
					</>
				) : null}
			</box>
			<box paddingLeft={2}>
				<text fg={dealtWith ? theme.muted : theme.text}>{message.body}</text>
			</box>
		</box>
	);
}

function InlineThread({
	thread,
	replyComposer,
	onReply,
	onDeleteThread,
	onDeleteMessage,
	onToggleStatus,
}: {
	thread: ReviewThread;
	replyComposer?: ReactNode;
	onReply: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteMessage: (threadId: string, messageId: string) => void;
	onToggleStatus: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const dealtWith = thread.status === THREAD_STATUS.DEALT_WITH;
	return (
		<box
			flexDirection="column"
			border
			borderColor={dealtWith ? theme.badgeAdded : theme.badgeModified}
			backgroundColor={theme.panel}
			title={` ${dealtWith ? "✓ Resolved" : "! Open"} · ${thread.id.slice(0, 8)} `}
			paddingLeft={1}
			paddingRight={1}
			marginLeft={2}
			marginRight={1}
			gap={1}
		>
			{thread.messages.map((message, index) => (
				<ThreadMessageView
					key={message.id}
					message={message}
					dealtWith={dealtWith}
					canDelete={index > 0}
					onDelete={(messageId) => onDeleteMessage(thread.id, messageId)}
				/>
			))}
			{replyComposer}
			<box flexDirection="row">
				<text
					fg={theme.accent}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onReply(thread);
					}}
				>
					[Reply]
				</text>
				<text> </text>
				<text
					fg={theme.accent}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggleStatus(thread);
					}}
				>
					[{dealtWith ? "Reopen" : "Resolve"}]
				</text>
				<box flexGrow={1} />
				<text
					fg={theme.badgeRemoved}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onDeleteThread(thread.id);
					}}
				>
					[Delete thread]
				</text>
			</box>
		</box>
	);
}

const commentRowId = (index: number) => `comment-row:${index}`;

const threadLocation = (thread: ReviewThread) =>
	`${thread.anchor.filePath}:${thread.anchor.startLine}${
		thread.anchor.endLine === thread.anchor.startLine ? "" : `-${thread.anchor.endLine}`
	}`;

/** The narration stopped quoting this thread's code; it is kept and shown, never pruned. */
const ORPHANED_THREAD_NOTE = " · no longer quoted";

function CommentRow({
	thread,
	index,
	active,
	orphaned,
	onJump,
}: {
	thread: ReviewThread;
	index: number;
	active: boolean;
	orphaned: boolean;
	onJump: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const dealtWith = thread.status === THREAD_STATUS.DEALT_WITH;
	const root = thread.messages[0];
	const replies = thread.messages.length - 1;
	const snippet = root?.body.split("\n")[0] ?? "";
	return (
		<box
			id={commentRowId(index)}
			height={1}
			width="100%"
			flexDirection="row"
			backgroundColor={active ? theme.panelAlt : undefined}
			onMouseDown={() => onJump(thread)}
		>
			<text flexShrink={0} fg={active ? theme.accent : theme.panelAlt}>
				{active ? "▸" : " "}
			</text>
			<text flexShrink={0} fg={dealtWith ? theme.badgeAdded : theme.badgeModified}>
				{dealtWith ? "✓ " : "! "}
			</text>
			<text
				flexShrink={0}
				wrapMode="none"
				fg={orphaned ? theme.muted : active ? theme.accent : theme.text}
			>
				{threadLocation(thread)}
			</text>
			{orphaned ? (
				<text flexShrink={0} wrapMode="none" fg={theme.badgeModified}>
					{ORPHANED_THREAD_NOTE}
				</text>
			) : null}
			<text flexShrink={0} fg={theme.muted}>{` ${root?.author.name ?? ""} `}</text>
			<text
				flexGrow={1}
				minWidth={0}
				wrapMode="none"
				truncate
				fg={dealtWith ? theme.muted : theme.text}
			>
				{snippet}
			</text>
			{replies > 0 ? (
				<text flexShrink={0} fg={theme.muted}>
					{` · ${replies} ${replies === 1 ? "reply" : "replies"}`}
				</text>
			) : null}
		</box>
	);
}

/** Every thread in the run at a glance; Enter re-enters the chapter that owns it. */
function CommentsView({
	threads,
	selected,
	orphaned,
	onJump,
}: {
	threads: ReviewThread[];
	selected: number;
	orphaned: ReadonlySet<string>;
	onJump: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const open = threads.filter((thread) => thread.status === THREAD_STATUS.OPEN).length;
	if (!threads.length) {
		return (
			<box flexDirection="column" width="100%" gap={1}>
				<text fg={theme.text}>No comments in this review yet.</text>
				<text fg={theme.muted}>
					Select diff lines and press Enter to start a thread; it will appear here.
				</text>
			</box>
		);
	}
	return (
		<box flexDirection="column" width="100%">
			<text fg={theme.muted}>
				{`${open} open · ${threads.length - open} resolved — Enter opens a comment in its chapter`}
			</text>
			<box height={1} />
			{threads.map((thread, index) => (
				<CommentRow
					key={thread.id}
					thread={thread}
					index={index}
					active={index === selected}
					orphaned={orphaned.has(thread.id)}
					onJump={onJump}
				/>
			))}
		</box>
	);
}

const THREAD_COMPOSER_ID = "inline-thread-composer";
const COPY_NOTICE_MS = 2_500;
const SELECTION_FLASH_MS = 150;

const flashTextSelection = ({
	renderer,
	theme,
	onFinish,
}: {
	renderer: CliRenderer;
	theme: Theme;
	onFinish: () => void;
}): (() => void) | null => {
	const selection = renderer.getSelection();
	if (!selection) return null;
	const renderables = selection.selectedRenderables.filter(
		(renderable): renderable is TextRenderable => renderable instanceof TextRenderable,
	);
	const previous = renderables.map((renderable) => ({
		renderable,
		background: renderable.selectionBg,
		foreground: renderable.selectionFg,
	}));
	for (const { renderable } of previous) {
		renderable.selectionBg = theme.badgeAdded;
		renderable.selectionFg = theme.panelAlt;
	}
	let active = true;
	const finish = () => {
		if (!active) return;
		active = false;
		renderer.clearSelection();
		for (const { renderable, background, foreground } of previous) {
			if (!renderable.isDestroyed) {
				renderable.selectionBg = background;
				renderable.selectionFg = foreground;
			}
		}
		onFinish();
	};
	const timeout = setTimeout(finish, SELECTION_FLASH_MS);
	return () => {
		if (!active) return;
		active = false;
		clearTimeout(timeout);
		onFinish();
	};
};

function ThreadComposer({
	title,
	body,
	notice,
	copyNotice,
	linkBlocker,
	textareaRef,
	onContentChange,
	onSave,
	onCancel,
	onCopyLocation,
	onCopyLink,
}: {
	title: string;
	body: string;
	notice: string | null;
	copyNotice: string | null;
	/** Why a permalink is unavailable for this range, or null when one is. */
	linkBlocker: string | null;
	textareaRef: RefObject<TextareaRenderable | null>;
	onContentChange: () => void;
	onSave: () => void;
	onCancel: () => void;
	onCopyLocation: () => void;
	onCopyLink: () => void;
}) {
	const theme = useTheme();
	const cursorPositioned = useRef(false);
	useEffect(() => {
		if (cursorPositioned.current || !textareaRef.current) return;
		textareaRef.current.cursorOffset = body.length;
		cursorPositioned.current = true;
	});

	return (
		<box
			id={THREAD_COMPOSER_ID}
			flexDirection="column"
			border
			borderColor={theme.accent}
			paddingLeft={1}
			paddingRight={1}
		>
			<text fg={theme.accent}>{title}</text>
			<textarea
				ref={textareaRef}
				initialValue={body}
				focused
				height={4}
				placeholder="Write feedback…"
				backgroundColor={theme.background}
				focusedBackgroundColor={theme.background}
				textColor={theme.text}
				focusedTextColor={theme.text}
				onContentChange={onContentChange}
				onKeyDown={(key) => {
					if (key.name === "escape") {
						key.preventDefault();
						key.stopPropagation();
						onCancel();
					} else if (key.name === "return" && key.ctrl) {
						key.preventDefault();
						key.stopPropagation();
						onSave();
					} else if (key.name === "y" && key.ctrl) {
						key.preventDefault();
						key.stopPropagation();
						onCopyLocation();
					} else if (key.name === "g" && key.ctrl) {
						key.preventDefault();
						key.stopPropagation();
						if (!linkBlocker) onCopyLink();
					}
				}}
			/>
			{notice ? <text fg={theme.badgeRemoved}>{notice}</text> : null}
			{copyNotice ? (
				<text fg={theme.badgeAdded} wrapMode="none" truncate>
					{copyNotice}
				</text>
			) : null}
			<box flexDirection="row" flexWrap="wrap">
				<text fg={theme.badgeAdded} onMouseDown={onSave}>
					[Save Ctrl+Enter]
				</text>
				<text> </text>
				<text fg={theme.text} onMouseDown={onCopyLocation}>
					[Copy path Ctrl+Y]
				</text>
				<text> </text>
				<text
					fg={linkBlocker ? theme.muted : theme.text}
					onMouseDown={() => {
						if (!linkBlocker) onCopyLink();
					}}
				>
					[Copy link Ctrl+G]
				</text>
				<text> </text>
				<text fg={theme.muted} onMouseDown={onCancel}>
					[Cancel Escape]
				</text>
			</box>
		</box>
	);
}

// Story headers have no tree to draw, so tree mode reads as smart there.
const headerPathFormatter = (mode: PathDisplayMode) =>
	mode === "full" ? undefined : (path: string, width: number) => formatDisplayPath({ path, width });

const fileHeaderId = (chapterId: string, index: number) =>
	`chapter-file-header:${chapterId}:${index}`;

/** How a view reaches the context-expansion machinery the app shell owns. */
type ContextExpansionUi = {
	variantFor: (path: string) => DiffFile | undefined;
	expandersFor: (path: string, base: DiffFileInput) => DiffBodyProps["expanders"];
};

/** An interlude has no diff, so its content column is just the close and the keys that follow it. */
function InterludeClose({ keymap }: { keymap: readonly KeymapAction[] }) {
	const theme = useTheme();
	const markRead = keymapHint("toggle-chapter-review", keymap) ?? "";
	const nextPage = keymapHint("next-page", keymap) ?? "";
	return (
		<box flexDirection="column" width="100%">
			<text fg={theme.muted}>{INTERLUDE_CLOSE}</text>
			<text fg={theme.muted}>{`${markRead} mark this chapter read · ${nextPage} next page`}</text>
		</box>
	);
}

function ChapterView({
	chapter,
	diffTheme,
	diffFiles,
	visibleDiffFiles,
	bodyPlans,
	diagrams,
	excerpts,
	focusedExcerpt,
	excerptSelection,
	windowPlan,
	width,
	vs,
	pathDisplay,
	selectedFile,
	selectedHunkIndex,
	selectedKeyChange,
	collapsedFiles,
	threads,
	selectedThreadRange,
	threadDraft,
	excerptDraft,
	replyDraft,
	contextExpansion,
	onAttachmentNode,
	onSelectFile,
	onToggleDiagram,
	onToggleExcerpt,
	onSelectExcerptRange,
	onExcerptRangeContextMenu,
	onToggleCollapse,
	onToggleFileReview,
	onSelectThreadRange,
	onRangeContextMenu,
	onReplyThread,
	onDeleteThread,
	onDeleteThreadMessage,
	onToggleThreadStatus,
}: {
	chapter: Chapter;
	diffTheme: Theme;
	diffFiles: DiffFile[] | null;
	visibleDiffFiles: ChapterDiffFile[];
	bodyPlans: ReadonlyMap<string, DiffVisualPlan>;
	diagrams: readonly ViewportDiagram[];
	excerpts: readonly ViewportExcerpt[];
	focusedExcerpt: string | null;
	excerptSelection: DiffLineRange | null;
	windowPlan: WindowPlanItem[];
	width: number;
	vs: ViewState;
	pathDisplay: PathDisplayMode;
	selectedFile: number;
	selectedHunkIndex: number;
	selectedKeyChange: number;
	collapsedFiles: Set<string>;
	threads: ReviewThread[];
	selectedThreadRange: DiffLineRange | undefined;
	threadDraft: DiffInlineAttachment | undefined;
	/** The composer for a new thread on quoted code, which mounts inside its excerpt block. */
	excerptDraft: DiffInlineAttachment | undefined;
	replyDraft: { threadId: string; content: ReactNode } | undefined;
	contextExpansion?: ContextExpansionUi;
	onAttachmentNode: (id: string, node: { height: number } | null) => void;
	onSelectFile: (index: number) => void;
	onToggleDiagram: (key: string) => void;
	onToggleExcerpt: (key: string) => void;
	onSelectExcerptRange: (range: DiffLineRange) => void;
	onExcerptRangeContextMenu: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onToggleCollapse: (path: string) => void;
	onToggleFileReview: (path: string) => void;
	onSelectThreadRange: (range: DiffLineRange) => void;
	onRangeContextMenu: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onReplyThread: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteThreadMessage: (threadId: string, messageId: string) => void;
	onToggleThreadStatus: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const paths = chapterFilePaths(chapter);
	const filesByPath = new Map(visibleDiffFiles.map((file) => [file.chapterPath, file]));
	const focusedDecorationId = `key-change:${chapter.id}:${selectedKeyChange}`;
	// Stable identities matter here: DiffBody memoises row building on its file
	// and decoration props, so rebuilding these per render would re-derive every
	// diff on unrelated state changes (e.g. dragging the sidebar divider).
	const decorations: RangeDecoration[] = useMemo(() => {
		const keyChange = chapter.keyChanges[selectedKeyChange];
		return (keyChange?.lineRefs ?? []).map((ref, refIndex) => ({
			...ref,
			id: `${focusedDecorationId}:${refIndex}`,
			focusId: focusedDecorationId,
			backgroundColor: severityBackgroundColor(theme, keyChange?.severity),
			showGutterMarker: false,
		}));
	}, [chapter, selectedKeyChange, focusedDecorationId, theme]);
	const mountThread = (thread: ReviewThread): DiffInlineAttachment => ({
		id: thread.id,
		anchor: diffRangeForAnchor(thread.anchor),
		content: (
			<InlineThread
				thread={thread}
				replyComposer={replyDraft?.threadId === thread.id ? replyDraft.content : undefined}
				onReply={onReplyThread}
				onDeleteThread={onDeleteThread}
				onDeleteMessage={onDeleteThreadMessage}
				onToggleStatus={onToggleThreadStatus}
			/>
		),
	});
	const inlineAttachments: DiffInlineAttachment[] = [
		...chapterHunkThreads(chapter, threads).map(mountThread),
		...(threadDraft ? [threadDraft] : []),
	];
	const excerptAttachments: DiffInlineAttachment[] = [
		...chapterExcerptThreads(chapter, threads).map(mountThread),
		...(excerptDraft ? [excerptDraft] : []),
	];

	return (
		<box flexDirection="column" width="100%">
			{windowPlan.map((item, planIndex) => {
				if (item.kind === "gap") {
					// biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional and stateless.
					return <box key={`gap:${planIndex}`} height={item.height} flexShrink={0} width="100%" />;
				}
				const path = segmentPath(item.id);
				const kind = segmentKind(item.id);
				if (kind === "excpad" || kind === "diapad") {
					return <box key={item.id} height={1} flexShrink={0} width="100%" />;
				}
				if (kind === "dia") {
					const diagram = diagrams.find((candidate) => candidate.key === path);
					if (!diagram) return null;
					return (
						<DiagramBlock
							key={item.id}
							plan={diagram.plan}
							theme={diffTheme}
							window={item.window}
							onToggle={onToggleDiagram}
						/>
					);
				}
				if (kind === "exc") {
					const excerpt = excerpts.find((candidate) => candidate.key === path);
					if (!excerpt) return null;
					return (
						<ExcerptBlock
							key={item.id}
							plan={excerpt.plan}
							theme={diffTheme}
							focused={focusedExcerpt === excerpt.key}
							window={item.window}
							onToggle={onToggleExcerpt}
							selectedRange={
								excerptSelection && excerptCovers(excerpt.plan.quotation, excerptSelection)
									? excerptSelection
									: undefined
							}
							inlineAttachments={excerptAttachments}
							onAttachmentNode={onAttachmentNode}
							onRangeSelect={onSelectExcerptRange}
							onRangeContextMenu={onExcerptRangeContextMenu}
						/>
					);
				}
				const diffFile = filesByPath.get(path);
				if (!diffFile) return null;
				const fileIndex = paths.indexOf(path);
				const focused = fileIndex === selectedFile;
				if (kind === "sep") {
					return (
						<text key={item.id} fg={theme.border}>
							{"─".repeat(Math.max(1, width - 2))}
						</text>
					);
				}
				if (kind === "head") {
					const collapsed = collapsedFiles.has(path);
					const reviewed = isFileReviewed(vs, chapter.id, path);
					return (
						<box
							key={item.id}
							id={fileHeaderId(chapter.id, fileIndex)}
							flexDirection="row"
							height={1}
							width="100%"
						>
							<text flexShrink={0} fg={focused ? theme.accent : theme.panelAlt}>
								{focused ? "▸" : " "}
							</text>
							<text
								flexShrink={0}
								fg={reviewed ? theme.badgeAdded : theme.muted}
								onMouseDown={() => onToggleFileReview(path)}
							>
								[{reviewed ? "x" : " "}]
							</text>
							<text
								flexShrink={0}
								fg={focused ? theme.accent : theme.muted}
								onMouseDown={() => onToggleCollapse(path)}
							>
								{collapsed ? "▶" : "▼"}
							</text>
							<box flexGrow={1} minWidth={0}>
								<DiffFileHeader
									file={diffFile}
									theme={diffTheme}
									width={Math.max(1, width - 7)}
									formatPath={headerPathFormatter(pathDisplay)}
									onSelect={() => onSelectFile(fileIndex)}
								/>
							</box>
						</box>
					);
				}
				const displayed = contextExpansion?.variantFor(path) ?? diffFile;
				const plan = bodyPlans.get(path);
				if (!plan) return null;
				return (
					<DiffBody
						key={item.id}
						plan={plan}
						theme={diffTheme}
						selectedHunkIndex={focused ? selectedHunkIndex : -1}
						decorations={decorations}
						focusedDecorationId={focusedDecorationId}
						selectedRange={selectedThreadRange}
						inlineAttachments={inlineAttachments}
						resolveRange={displayed === diffFile ? undefined : gitRangeResolver(diffFiles, path)}
						expanders={contextExpansion?.expandersFor(path, diffFile)}
						window={item.window}
						onAttachmentNode={onAttachmentNode}
						onRangeSelect={onSelectThreadRange}
						onRangeContextMenu={onRangeContextMenu}
					/>
				);
			})}
		</box>
	);
}

// ── Semantic view ──────────────────────────────────────────────────────────
type SemanticPreparedFile = {
	path: string;
	file: DiffFile | null;
	notes: string[];
	emphasis: SemanticEmphasis;
};

type PreparedSemantic = { version: string; files: SemanticPreparedFile[] };

const prepareSemantic = (result: SemanticDiffResult): PreparedSemantic => ({
	version: result.version,
	files: result.files.map((file) => ({
		path: file.path,
		file: file.patch ? (parsePatch(file.patch, `semantic:${file.path}`)[0] ?? null) : null,
		notes: file.notes,
		emphasis: file.emphasis,
	})),
});

const semanticDiffFiles = (semantic: PreparedSemantic | null): DiffFile[] =>
	semantic?.files.flatMap((file) => (file.file ? [file.file] : [])) ?? [];

/** Anchors emitted from semantic rows resolve against the authoritative patch hunks. */
const gitRangeResolver =
	(diffFiles: DiffFile[] | null, path: string) =>
	(side: DiffSide, line: number): DiffLineRange | null => {
		const hunks = diffFiles?.find((candidate) => candidate.path === path)?.metadata.hunks ?? [];
		const hunk = hunks.find((candidate) => {
			const start = side === "additions" ? candidate.additionStart : candidate.deletionStart;
			const count = side === "additions" ? candidate.additionCount : candidate.deletionCount;
			return count > 0 && line >= start && line < start + count;
		});
		if (!hunk) return null;
		return {
			filePath: path,
			hunkOldStart: hunk.deletionStart,
			side,
			startLine: line,
			endLine: line,
		};
	};

function SemanticChapterView({
	chapter,
	semantic,
	diffTheme,
	diffFiles,
	bodyPlans,
	windowPlan,
	width,
	vs,
	pathDisplay,
	selectedFile,
	selectedKeyChange,
	collapsedFiles,
	threads,
	selectedThreadRange,
	threadDraft,
	replyDraft,
	onAttachmentNode,
	onSelectFile,
	onToggleCollapse,
	onToggleFileReview,
	onSelectThreadRange,
	onRangeContextMenu,
	onReplyThread,
	onDeleteThread,
	onDeleteThreadMessage,
	onToggleThreadStatus,
}: {
	chapter: Chapter;
	semantic: PreparedSemantic;
	diffTheme: Theme;
	diffFiles: DiffFile[] | null;
	bodyPlans: ReadonlyMap<string, DiffVisualPlan>;
	windowPlan: WindowPlanItem[];
	width: number;
	vs: ViewState;
	pathDisplay: PathDisplayMode;
	selectedFile: number;
	selectedKeyChange: number;
	collapsedFiles: Set<string>;
	threads: ReviewThread[];
	selectedThreadRange: DiffLineRange | undefined;
	threadDraft: DiffInlineAttachment | undefined;
	replyDraft: { threadId: string; content: ReactNode } | undefined;
	onAttachmentNode: (id: string, node: { height: number } | null) => void;
	onSelectFile: (index: number) => void;
	onToggleCollapse: (path: string) => void;
	onToggleFileReview: (path: string) => void;
	onSelectThreadRange: (range: DiffLineRange) => void;
	onRangeContextMenu: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onReplyThread: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteThreadMessage: (threadId: string, messageId: string) => void;
	onToggleThreadStatus: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const paths = chapterFilePaths(chapter);
	const focusedDecorationId = `key-change:${chapter.id}:${selectedKeyChange}`;
	// Stable identity keeps DiffBody's row memo intact across unrelated renders.
	const decorations: RangeDecoration[] = useMemo(() => {
		const keyChange = chapter.keyChanges[selectedKeyChange];
		return (keyChange?.lineRefs ?? []).map((ref, refIndex) => ({
			...ref,
			id: `${focusedDecorationId}:${refIndex}`,
			focusId: focusedDecorationId,
			backgroundColor: severityBackgroundColor(theme, keyChange?.severity),
			showGutterMarker: false,
		}));
	}, [chapter, selectedKeyChange, focusedDecorationId, theme]);
	const emphasisByPath = useMemo(() => {
		const emphasis = new Map<string, SpanEmphasis>();
		for (const file of semantic.files) {
			if (!file.file) continue;
			emphasis.set(file.path, {
				rangesFor: (side, line) =>
					(side === "deletions" ? file.emphasis.deletions : file.emphasis.additions).get(line),
				deletionsFg: theme.badgeRemoved,
				additionsFg: theme.badgeAdded,
			});
		}
		return emphasis;
	}, [semantic, theme.badgeRemoved, theme.badgeAdded]);
	// Semantic view renders no excerpts, so threads on quoted code have nowhere to sit here.
	const chapterThreads = threads.filter(
		(thread) => !isExcerptAnchor(thread.anchor) && paths.includes(thread.anchor.filePath),
	);
	const inlineAttachments: DiffInlineAttachment[] = [
		...chapterThreads.map((thread) => ({
			id: thread.id,
			anchor: diffRangeForAnchor(thread.anchor),
			content: (
				<InlineThread
					thread={thread}
					replyComposer={replyDraft?.threadId === thread.id ? replyDraft.content : undefined}
					onReply={onReplyThread}
					onDeleteThread={onDeleteThread}
					onDeleteMessage={onDeleteThreadMessage}
					onToggleStatus={onToggleThreadStatus}
				/>
			),
		})),
		...(threadDraft ? [threadDraft] : []),
	];

	return (
		<box flexDirection="column" width="100%">
			{windowPlan.map((item, planIndex) => {
				if (item.kind === "gap") {
					// biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional and stateless.
					return <box key={`gap:${planIndex}`} height={item.height} flexShrink={0} width="100%" />;
				}
				const path = segmentPath(item.id);
				const semanticFile = semantic.files.find((candidate) => candidate.path === path);
				if (!semanticFile) return null;
				const kind = segmentKind(item.id);
				const fileIndex = paths.indexOf(path);
				const focused = fileIndex === selectedFile;
				if (kind === "pad") {
					return <box key={item.id} height={1} flexShrink={0} width="100%" />;
				}
				if (kind === "sep") {
					return (
						<text key={item.id} fg={theme.border}>
							{"─".repeat(Math.max(1, width - 2))}
						</text>
					);
				}
				if (kind === "notes") {
					return (
						<box key={item.id} flexDirection="column" width="100%">
							{semanticFile.notes.slice(item.window.start, item.window.end).map((note) => (
								<text key={note} fg={theme.muted} wrapMode="none" truncate>
									{note}
								</text>
							))}
						</box>
					);
				}
				if (kind === "head") {
					const collapsed = collapsedFiles.has(path);
					const reviewed = isFileReviewed(vs, chapter.id, path);
					return (
						<box
							key={item.id}
							id={fileHeaderId(chapter.id, fileIndex)}
							flexDirection="row"
							height={1}
							width="100%"
						>
							<text flexShrink={0} fg={focused ? theme.accent : theme.panelAlt}>
								{focused ? "▸" : " "}
							</text>
							<text
								flexShrink={0}
								fg={reviewed ? theme.badgeAdded : theme.muted}
								onMouseDown={() => onToggleFileReview(path)}
							>
								[{reviewed ? "x" : " "}]
							</text>
							<text
								flexShrink={0}
								fg={focused ? theme.accent : theme.muted}
								onMouseDown={() => onToggleCollapse(path)}
							>
								{collapsed ? "▶" : "▼"}
							</text>
							{semanticFile.file ? (
								<box flexGrow={1} minWidth={0}>
									<DiffFileHeader
										file={semanticFile.file}
										theme={diffTheme}
										width={Math.max(1, width - 7)}
										formatPath={headerPathFormatter(pathDisplay)}
										onSelect={() => onSelectFile(fileIndex)}
									/>
								</box>
							) : (
								<text
									flexShrink={1}
									minWidth={0}
									wrapMode="none"
									truncate
									fg={focused ? theme.accent : theme.muted}
									onMouseDown={() => onSelectFile(fileIndex)}
								>
									{" "}
									{path}
								</text>
							)}
						</box>
					);
				}
				if (!semanticFile.file) return null;
				const emphasis = emphasisByPath.get(path);
				const plan = bodyPlans.get(path);
				if (!emphasis || !plan) return null;
				return (
					<DiffBody
						key={item.id}
						plan={plan}
						theme={diffTheme}
						selectedHunkIndex={-1}
						decorations={decorations}
						focusedDecorationId={focusedDecorationId}
						selectedRange={selectedThreadRange}
						inlineAttachments={inlineAttachments}
						emphasis={emphasis}
						resolveRange={gitRangeResolver(diffFiles, path)}
						window={item.window}
						onAttachmentNode={onAttachmentNode}
						onRangeSelect={onSelectThreadRange}
						onRangeContextMenu={onRangeContextMenu}
					/>
				);
			})}
		</box>
	);
}

// ── Keyboard help ──────────────────────────────────────────────────────────
const HELP_MODAL_MAX_WIDTH = 66;

/** Floats over the review rather than displacing it, so the page stays in sight. */
function HelpModal({
	terminalWidth,
	terminalHeight,
	scrollRef,
	onClose,
	keymap = KEYMAP,
	issues = [],
	themeIssues = [],
}: {
	terminalWidth: number;
	terminalHeight: number;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	onClose: () => void;
	keymap?: readonly KeymapAction[];
	issues?: readonly KeymapIssue[];
	themeIssues?: readonly ThemeIssue[];
}) {
	const theme = useTheme();
	const sections = useMemo(() => keymapSections(keymap), [keymap]);
	const shortcutRows = useMemo(
		() =>
			sections.reduce((total, section) => total + section.lines.length + 1, 0) +
			(issues.length > 0 ? issues.length + 1 : 0) +
			(themeIssues.length > 0 ? themeIssues.length + 1 : 0),
		[sections, issues, themeIssues],
	);
	const width = Math.max(20, Math.min(HELP_MODAL_MAX_WIDTH, terminalWidth - 4));
	const height = Math.max(5, Math.min(shortcutRows + 3, terminalHeight - 4));
	return (
		<>
			<box
				position="absolute"
				top={0}
				left={0}
				width="100%"
				height="100%"
				zIndex={60}
				shouldFill={false}
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}}
			/>
			<box
				position="absolute"
				top={Math.max(0, Math.round((terminalHeight - height) / 2))}
				left={Math.max(0, Math.round((terminalWidth - width) / 2))}
				width={width}
				height={height}
				zIndex={70}
				border
				borderColor={theme.accent}
				backgroundColor={theme.background}
				title=" Keyboard shortcuts "
				flexDirection="column"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					flexShrink={1}
					minHeight={0}
					paddingLeft={1}
					paddingRight={1}
					scrollY
					verticalScrollbarOptions={{ trackOptions: { foregroundColor: theme.border } }}
				>
					{issues.length > 0 ? (
						<box flexDirection="column" width="100%">
							<text fg={theme.badgeRemoved}>Keybinding overrides ignored</text>
							{issues.map((issue) => (
								<text
									key={`${issue.entry}-${issue.reason}`}
									fg={theme.badgeRemoved}
									wrapMode="none"
									truncate
								>
									{`  ${issue.entry}: ${issue.reason}`}
								</text>
							))}
						</box>
					) : null}
					{themeIssues.length > 0 ? (
						<box flexDirection="column" width="100%">
							<text fg={theme.badgeRemoved}>Theme issues ignored</text>
							{themeIssues.map((issue) => (
								<text
									key={`${issue.entry}-${issue.reason}`}
									fg={theme.badgeRemoved}
									wrapMode="none"
									truncate
								>
									{`  ${issue.entry}: ${issue.reason}`}
								</text>
							))}
						</box>
					) : null}
					{sections.map((section) => (
						<box key={section.title} flexDirection="column" width="100%">
							<text fg={theme.heading}>{section.title}</text>
							{section.lines.map((line) => (
								<text key={line} fg={theme.text} wrapMode="none" truncate>
									{`  ${line}`}
								</text>
							))}
						</box>
					))}
				</scrollbox>
				<box flexShrink={0} height={1} paddingLeft={1}>
					<text fg={theme.muted}>? or Esc to close</text>
				</box>
			</box>
		</>
	);
}

function ConfirmDialog({
	message,
	confirmLabel,
	terminalWidth,
	terminalHeight,
	onConfirm,
	onCancel,
}: {
	message: string;
	confirmLabel: string;
	terminalWidth: number;
	terminalHeight: number;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const theme = useTheme();
	const width = Math.max(24, Math.min(48, terminalWidth - 4));
	const height = 5;
	return (
		<>
			<box
				position="absolute"
				top={0}
				left={0}
				width="100%"
				height="100%"
				zIndex={60}
				shouldFill={false}
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				}}
			/>
			<box
				position="absolute"
				top={Math.max(0, Math.round((terminalHeight - height) / 2))}
				left={Math.max(0, Math.round((terminalWidth - width) / 2))}
				width={width}
				height={height}
				zIndex={70}
				border
				borderColor={theme.badgeRemoved}
				backgroundColor={theme.background}
				flexDirection="column"
				paddingLeft={1}
				paddingRight={1}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<text fg={theme.text}>{message}</text>
				<box flexDirection="row" marginTop={1}>
					<text
						fg={theme.badgeRemoved}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onConfirm();
						}}
					>
						[{confirmLabel}]
					</text>
					<text> </text>
					<text
						fg={theme.accent}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onCancel();
						}}
					>
						[Cancel]
					</text>
					<box flexGrow={1} />
					<text fg={theme.muted}>enter · esc</text>
				</box>
			</box>
		</>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
type ThreadDraft =
	| { kind: "thread"; anchor: ThreadAnchor; range: DiffLineRange }
	| { kind: "reply"; threadId: string; range: DiffLineRange };

type ContextMenuState = {
	position: { x: number; y: number };
	selected: number;
	/** Whatever was dragged over when the menu opened, so the entry survives the menu taking focus. */
	selectedText: string | null;
} & (
	| {
			kind: "range";
			range: DiffLineRange;
			/** Which anchor a comment on this range would take; quoted code takes an excerpt one. */
			anchorKind: (typeof THREAD_ANCHOR_KIND)[keyof typeof THREAD_ANCHOR_KIND];
	  }
	| { kind: "prose"; reference: ChapterReference }
);

/** The verbs a selected range answers to, shared by the pointer menu and the composer footer. */
const buildRangeMenu = ({
	selectedText,
	linkBlocker,
	copyText,
	copyLocation,
	copyLink,
	comment,
	keymap = KEYMAP,
}: {
	selectedText: string | null;
	linkBlocker: string | null;
	copyText: () => void;
	copyLocation: () => void;
	copyLink: () => void;
	comment: () => void;
	keymap?: readonly KeymapAction[];
}): MenuEntry[] => [
	...(selectedText
		? ([
				{
					kind: "item",
					label: "Copy selected text",
					hint: keymapHint("copy-selection", keymap),
					action: copyText,
				},
				{ kind: "separator", id: "text" },
			] as MenuEntry[])
		: []),
	{ kind: "item", label: "Copy path:line", hint: "Ctrl+Y", action: copyLocation },
	{
		kind: "item",
		label: linkBlocker ? `Copy GitHub link (${linkBlocker})` : "Copy GitHub link",
		hint: "Ctrl+G",
		disabled: Boolean(linkBlocker),
		action: copyLink,
	},
	{ kind: "separator", id: "copy" },
	{ kind: "item", label: "Comment on selection", hint: "Enter", action: comment },
];

const noVerb = () => undefined;

/** Narration answers to copying alone: it has no line to point at and takes no comments. */
const buildProseMenu = ({
	selectedText,
	copyText,
	copyWithReference,
	keymap = KEYMAP,
}: {
	selectedText: string | null;
	copyText: () => void;
	copyWithReference: () => void;
	keymap?: readonly KeymapAction[];
}): MenuEntry[] => [
	{
		kind: "item",
		label: "Copy selected text",
		hint: keymapHint("copy-selection", keymap),
		disabled: !selectedText,
		action: copyText,
	},
	{
		kind: "item",
		label: "Copy with chapter reference",
		disabled: !selectedText,
		action: copyWithReference,
	},
	{ kind: "separator", id: "copy" },
	{ kind: "item", label: "Copy path:line", hint: "Ctrl+Y", disabled: true, action: noVerb },
];

const defaultHumanAuthor: ThreadAuthor = {
	kind: THREAD_AUTHOR_KIND.HUMAN,
	name: "Reviewer",
};

const diffRangeForThread = (thread: ReviewThread): DiffLineRange =>
	diffRangeForAnchor(thread.anchor);

/** A thread reduced to what the viewport needs to reserve room for it. */
const measuredAnchor = (thread: ReviewThread): DiffInlineAttachment => ({
	id: thread.id,
	anchor: diffRangeForAnchor(thread.anchor),
	content: null,
});

export function App({
	file,
	context = null,
	omittedNotice = null,
	diffFiles = null,
	loadSemanticDiff,
	loadFileLines,
	initialViewState = emptyViewState(),
	initialSessionState = { pages: {} },
	initialPreferences = {},
	initialTheme = resolveTheme(undefined),
	initialSyntaxTheme = initialTheme.syntaxTheme,
	syntaxWarning,
	transparentSurfaces = false,
	initialThreads = [],
	threadActions,
	humanAuthor = defaultHumanAuthor,
	permalinks = null,
	onCopy,
	onViewStateChange,
	onSessionStateChange,
	onPreferencesChange,
	onThemeChange,
	onQuit,
	keymap = KEYMAP,
	keymapIssues = [],
	customThemes = [],
	themeIssues = [],
}: {
	/** Null for a chapterless run: the review opens straight onto the All files page. */
	file: RevueChaptersFile | null;
	/** Frozen quotations for the narration's excerpt citations; null until `context freeze` runs. */
	context?: RunContextFile | null;
	/**
	 * What an ignore rule kept out of the prepared run. Coverage counts are measured against the
	 * run, so without this a narrative can look complete while prep dropped half the change.
	 */
	omittedNotice?: string | null;
	diffFiles?: DiffFile[] | null;
	loadSemanticDiff?: () => Promise<SemanticDiffResult>;
	/** The pinned new-side blob for a path, split into lines; null when unavailable. */
	loadFileLines?: (path: string) => Promise<string[] | null>;
	initialViewState?: ViewState;
	initialSessionState?: ReviewSessionState;
	initialPreferences?: Preferences;
	initialTheme?: Theme;
	/** The syntax theme the caller already prepared highlights for. */
	initialSyntaxTheme?: string;
	/** A one-time native syntax fallback warning surfaced through the existing status bar. */
	syntaxWarning?: string;
	transparentSurfaces?: boolean;
	initialThreads?: ReviewThread[];
	threadActions?: ThreadActions;
	humanAuthor?: ThreadAuthor;
	/** Where the reviewed lines live on GitHub; absent when no GitHub remote is configured. */
	permalinks?: PermalinkContext | null;
	onCopy?: (text: string) => boolean;
	onViewStateChange?: (next: ViewState) => void;
	onSessionStateChange?: (next: ReviewSessionState) => void;
	onPreferencesChange?: (next: Preferences) => void;
	onThemeChange?: (next: Theme) => void;
	onQuit?: () => void;
	/** The registry merged with any `~/.revue/keybindings.json` overrides. */
	keymap?: readonly KeymapAction[];
	/** User keybinding entries dropped during the merge, surfaced in the footer and help overlay. */
	keymapIssues?: readonly KeymapIssue[];
	/** Themes read from `~/.revue/themes`; shadow bundled themes that share an id. */
	customThemes?: readonly Theme[];
	/** Custom theme files or keys dropped while loading, surfaced in the footer and help overlay. */
	themeIssues?: readonly ThemeIssue[];
}) {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [chosenTheme, setChosenTheme] = useState(initialTheme);
	const { themes: pickerThemes, customIds: customThemeIds } = useMemo(() => {
		const merged = mergeCustomThemes(customThemes);
		return { themes: orderThemesForPicker(merged.themes), customIds: merged.customIds };
	}, [customThemes]);
	const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);
	const [themePicker, setThemePicker] = useState<{ selected: number } | null>(null);
	const shownTheme = previewTheme ?? chosenTheme;
	const theme = transparentSurfaces ? withTransparentSurfaces(shownTheme) : shownTheme;
	const filesChapter = useMemo(
		() => allFilesChapter(diffFiles, (file?.chapters.length ?? 0) + 1),
		[diffFiles, file],
	);
	const filesPage = useMemo(
		(): Page => ({ kind: "files", label: ALL_FILES_LABEL, chapter: filesChapter }),
		[filesChapter],
	);
	// Coverage is derived, never stored, and exists only for a narrative that declared itself
	// partial — at full depth the reviewer is told nothing, because nothing was left out.
	const coverage = useMemo((): NarrativeCoverage | null => {
		const label = file ? partialDepthLabel(file) : null;
		if (!file || !label) return null;
		return {
			label,
			narrated: narratedUnitCount(file),
			total: filesChapter.hunkRefs.length,
		};
	}, [file, filesChapter]);
	const pages = useMemo(() => (file ? buildPages(file) : [filesPage]), [file, filesPage]);
	const chapters = pages.flatMap((candidate) =>
		candidate.kind === "chapter" ? [candidate.chapter] : [],
	);
	const restoredPage = pages.findIndex(
		(candidate) => pageId(candidate) === initialSessionState.pageId,
	);
	const initialAllFiles = Boolean(file) && initialSessionState.pageId === pageId(filesPage);
	const initialCurrent = restoredPage >= 0 ? restoredPage : 0;
	const initialPageState =
		initialSessionState.pages[pageId(initialAllFiles ? filesPage : pages[initialCurrent])] ??
		emptyReviewPageState();
	const sessionRef = useRef(initialSessionState);
	const preferencesRef = useRef(initialPreferences);
	const [current, setCurrent] = useState(initialCurrent);
	const [allFiles, setAllFiles] = useState(initialAllFiles);
	const [commentsSurface, setCommentsSurface] = useState(false);
	const [selectedThread, setSelectedThread] = useState(0);
	const [threadFocusTarget, setThreadFocusTarget] = useState<{
		threadId: string;
		request: number;
	} | null>(null);
	const [selectedFile, setSelectedFile] = useState(initialPageState.selectedFile);
	const [selectedHunkIndex, setSelectedHunkIndex] = useState(initialPageState.selectedHunk);
	const [selectedKeyChange, setSelectedKeyChange] = useState(initialPageState.selectedKeyChange);
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
		() => new Set(initialPageState.collapsedFiles),
	);
	const [openExcerpts, setOpenExcerpts] = useState<Set<string>>(
		() => new Set(initialPageState.openExcerpts),
	);
	const [foldedDiagrams, setFoldedDiagrams] = useState<Set<string>>(
		() => new Set(initialPageState.foldedDiagrams),
	);
	/** The excerpt the file cursor has stepped onto; excerpt rows carry no focus marker. */
	const [focusedExcerpt, setFocusedExcerpt] = useState<string | null>(null);
	/** A quoted range the gutter drag left behind. It has no composer to hold it, so it lives here. */
	const [excerptSelection, setExcerptSelection] = useState<DiffLineRange | null>(null);
	const [fileLines, setFileLines] = useState<Map<string, string[] | null>>(() => new Map());
	const [expansions, setExpansions] = useState<Map<string, FileExpansion>>(() => new Map());
	const [expandedVariants, setExpandedVariants] = useState<Map<string, DiffFile>>(() => new Map());
	const [fileFocusRequest, setFileFocusRequest] = useState(0);
	const [keyFocusRequest, setKeyFocusRequest] = useState(0);
	const [diffAnchorTarget, setDiffAnchorTarget] = useState<{
		id: string;
		path: string;
		anchor: DecorationAnchor;
		request: number;
	} | null>(null);
	const [showHelp, setShowHelp] = useState(false);
	const [indexExpanded, setIndexExpandedState] = useState(initialPreferences.indexExpanded ?? true);
	const [sidebarPreference, setSidebarPreferenceState] = useState<SidebarPreference>(
		initialPreferences.sidebarPreference ?? "auto",
	);
	const [diffPreference, setDiffPreferenceState] = useState<DiffLayoutPreference>(
		initialPreferences.diffPreference ?? "auto",
	);
	const [lineNumbers, setLineNumbersState] = useState(initialPreferences.lineNumbers ?? true);
	const [changeMarkers, setChangeMarkersState] = useState(initialPreferences.changeMarkers ?? true);
	const [fileDisplay, setFileDisplayState] = useState<FileDisplayPreference>(
		initialPreferences.fileDisplay ?? "all",
	);
	const [pathDisplay, setPathDisplayState] = useState<PathDisplayMode>(
		initialPreferences.pathDisplay ?? "smart",
	);
	const [viewMode, setViewModeState] = useState<"patch" | "semantic">("patch");
	const [semantic, setSemantic] = useState<PreparedSemantic | null>(null);
	const [semanticLoading, setSemanticLoading] = useState(false);
	const [semanticNotice, setSemanticNotice] = useState<string | null>(null);
	const [vs, setVs] = useState(initialViewState);
	const [threads, setThreads] = useState(() => sortThreads(initialThreads));
	const [threadDraft, setThreadDraft] = useState<ThreadDraft | null>(null);
	const [threadBody, setThreadBody] = useState("");
	const [threadNotice, setThreadNotice] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<
		| { kind: "thread"; threadId: string }
		| { kind: "message"; threadId: string; messageId: string }
		| null
	>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	// The nonce re-arms the timeout when the same text is copied twice running.
	const [copyNotice, setCopyNotice] = useState<{ text: string; nonce: number } | null>(null);
	const selectionFlashCleanup = useRef<(() => void) | null>(null);
	const textareaRef = useRef<TextareaRenderable>(null);
	const pageScroll = useRef<ScrollBoxRenderable>(null);
	const pendingViewProgress = useRef<{ mode: "patch" | "semantic"; progress: number } | null>(null);
	const panelScroll = useRef<ScrollBoxRenderable>(null);
	const indexScroll = useRef<ScrollBoxRenderable>(null);
	const helpScroll = useRef<ScrollBoxRenderable>(null);
	const resizingPanel = useRef(false);
	const startupViewRestored = useRef(false);
	const chapterNavigationPrefix = useRef<"[" | "]" | null>(null);
	const [requestedPanelWidth, setRequestedPanelWidthState] = useState(
		initialPreferences.panelWidth ?? defaultPanelWidth(width),
	);
	const {
		showSidebar: showChapterPanel,
		sidebarWidth: panelWidth,
		contentWidth,
		splitFits,
		splitReachable,
	} = resolveLayout({
		terminalWidth: width,
		requestedSidebarWidth: requestedPanelWidth,
		sidebar: sidebarPreference,
		diff: diffPreference,
	});
	const page = commentsSurface ? COMMENTS_PAGE : allFiles ? filesPage : pages[current];
	const surface: ReviewSurface =
		page?.kind === "files" ? "files" : page?.kind === "comments" ? "comments" : "story";
	const chapter = page?.kind === "chapter" || page?.kind === "files" ? page.chapter : null;
	const interlude = chapter ? isInterlude(chapter) : false;
	/**
	 * Whether the page's body is the planned content column. An interlude has no diff to swap,
	 * so its figures and quotations are planned in either view rather than only in Patch.
	 */
	const plannedBody = Boolean(chapter) && (viewMode === "patch" || interlude);
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();
	// Highlighting a file under a new syntax theme is asynchronous, so the diff keeps the last
	// prepared colours until the new ones exist rather than dropping back to unhighlighted text.
	const [preparedSyntaxTheme, setPreparedSyntaxTheme] = useState(initialSyntaxTheme);
	const diffTheme =
		preparedSyntaxTheme === theme.syntaxTheme
			? theme
			: { ...theme, syntaxTheme: preparedSyntaxTheme };

	// ── Viewport windowing ─────────────────────────────────────────────────
	// Only rows near the visible window mount; the rest are fixed-height gaps,
	// so layout cost tracks the screen rather than the diff.
	const windowingActive = Boolean(chapter);
	const leadingContent = useRef<{ height: number } | null>(null);
	const attachmentNodes = useRef(new Map<string, { height: number }>());
	const [attachmentHeights, setAttachmentHeights] = useState(() => new Map<string, number>());
	const scrollWin = useScrollWindow({
		scrollRef: pageScroll,
		leadingRef: leadingContent,
		enabled: windowingActive,
		step: SCROLL_STEP_ROWS,
	});
	const chapterDiffFiles = useMemo(
		() => (chapter && diffFiles ? selectChapterFiles(chapter, diffFiles) : []),
		[chapter, diffFiles],
	);
	const visibleChapterFiles = useMemo(() => {
		if (!chapter || fileDisplay !== "focused") return chapterDiffFiles;
		const focusedPath = chapterFilePaths(chapter)[selectedFile];
		return chapterDiffFiles.filter((file) => file.chapterPath === focusedPath);
	}, [chapterDiffFiles, chapter, fileDisplay, selectedFile]);
	const viewportFiles: ViewportFile[] = useMemo(
		() =>
			viewMode === "semantic"
				? semanticViewportFiles({
						chapter,
						semantic,
						fileDisplay,
						selectedFile,
						collapsedFiles,
						diffPreference,
						splitFits,
						diffFiles,
					})
				: visibleChapterFiles.map((diffFile, index) => {
						const path = diffFile.chapterPath;
						const displayed = expandedVariants.get(path) ?? diffFile;
						const lines = fileLines.get(path);
						return {
							path,
							displayed,
							collapsed: collapsedFiles.has(path),
							separator: index > 0,
							showLineNumbers: lineNumbers,
							showChangeMarkers: changeMarkers,
							layout: layoutForFile({ file: displayed, preference: diffPreference, splitFits }),
							expanderActions: lines
								? (boundary: number) =>
										boundaryActions(
											diffFile.metadata.hunks,
											expansions.get(path),
											lines.length,
											boundary,
										)
								: undefined,
							resolveRange:
								displayed === diffFile || !diffFiles
									? undefined
									: gitRangeResolver(diffFiles, path),
						};
					}),
		[
			viewMode,
			chapter,
			semantic,
			fileDisplay,
			selectedFile,
			visibleChapterFiles,
			expandedVariants,
			fileLines,
			expansions,
			collapsedFiles,
			diffPreference,
			lineNumbers,
			changeMarkers,
			splitFits,
			diffFiles,
		],
	);
	// Quoted code comes from the frozen context, never re-resolved from Git; a citation nothing
	// was frozen for simply does not appear.
	const chapterExcerpts = useMemo<ViewportExcerpt[]>(() => {
		if (!chapter || !plannedBody) return [];
		// Anchored against the chapter's own file order, not the viewport's: Focused display shows
		// one file, and placing every citation against that would move quotations between modes.
		const paths = chapterFilePaths(chapter);
		const onScreen = new Set(viewportFiles.map((entry) => entry.path));
		return distinctExcerpts(chapter).flatMap(({ key, excerpt }, index) => {
			const after = excerptAnchor(paths, index);
			if (after !== null && !onScreen.has(after)) return [];
			const frozen = frozenExcerptFor(context, excerpt);
			if (!frozen) return [];
			const quotation: ExcerptQuotation = { ...excerpt, lines: frozen.lines };
			return [
				{
					key,
					after,
					plan: planExcerpt({
						key,
						quotation,
						folded: !openExcerpts.has(key),
						width: contentWidth,
						chrome: OPENTUI_DIFF_CHROME,
					}),
				},
			];
		});
	}, [chapter, context, plannedBody, viewportFiles, openExcerpts, contentWidth]);
	/**
	 * Figures the chapter draws, taken from fenced blocks in its own summary rather than a
	 * schema field of their own. Unlike an excerpt, a figure is usually the point of the prose
	 * beside it — an interlude often has nothing else — so it draws open and folds on request.
	 */
	const chapterDiagrams = useMemo<ViewportDiagram[]>(() => {
		if (!chapter || !plannedBody) return [];
		return splitNarration(chapter.summary).diagrams.map((diagram, index) => {
			const key = diagramFoldKey(chapter.id, index);
			return {
				key,
				plan: planDiagram({
					key,
					diagram,
					folded: foldedDiagrams.has(key),
					width: contentWidth,
					chrome: OPENTUI_DIFF_CHROME,
				}),
			};
		});
	}, [chapter, plannedBody, foldedDiagrams, contentWidth]);
	/**
	 * What the file cursor steps through, in narration order. An excerpt is a stop on that walk
	 * so `toggle-file-diff` can open it, which is why folding needs no shortcut of its own.
	 */
	const focusTargets = useMemo<ChapterFocusTarget[]>(() => {
		const paths = chapter ? chapterFilePaths(chapter) : [];
		const anchored = new Set(paths);
		const excerptsAfter = (path: string | null): ChapterFocusTarget[] =>
			chapterExcerpts
				.filter((entry) => entry.after === path)
				.map((entry) => ({ kind: "excerpt", key: entry.key }));
		return [
			...excerptsAfter(null),
			...paths.flatMap((path, index): ChapterFocusTarget[] => [
				{ kind: "file", index },
				...excerptsAfter(path),
			]),
			...chapterExcerpts
				.filter((entry) => entry.after !== null && !anchored.has(entry.after))
				.map((entry): ChapterFocusTarget => ({ kind: "excerpt", key: entry.key })),
		];
	}, [chapter, chapterExcerpts]);
	const chapterThreadList = useMemo(() => {
		if (!chapter) return [];
		if (viewMode === "semantic") {
			const paths = chapterFilePaths(chapter);
			return threads.filter(
				(thread) => !isExcerptAnchor(thread.anchor) && paths.includes(thread.anchor.filePath),
			);
		}
		return chapterHunkThreads(chapter, threads);
	}, [chapter, threads, viewMode]);
	const chapterQuotedThreads = useMemo(
		() => (chapter && viewMode === "patch" ? chapterExcerptThreads(chapter, threads) : []),
		[chapter, threads, viewMode],
	);
	/**
	 * Threads on code the frozen context no longer quotes. Re-narrating at another depth can
	 * legitimately drop an excerpt, so these stay in the store and stay listed rather than being
	 * pruned; they simply have no quoted line to render against.
	 */
	const orphanedThreads = useMemo(
		() =>
			new Set(
				threads
					.filter(
						(thread) =>
							isExcerptAnchor(thread.anchor) && !frozenExcerptContaining(context, thread.anchor),
					)
					.map((thread) => thread.id),
			),
		[threads, context],
	);
	const orderedThreads = useMemo(
		() =>
			[...threads].sort(
				(left, right) =>
					left.anchor.filePath.localeCompare(right.anchor.filePath) ||
					left.anchor.startLine - right.anchor.startLine ||
					left.createdAt.localeCompare(right.createdAt) ||
					left.id.localeCompare(right.id),
			),
		[threads],
	);
	const quotedDraft = threadDraft?.kind === "thread" && isExcerptAnchor(threadDraft.anchor);
	const attachmentAnchors = useMemo<DiffInlineAttachment[]>(
		() => [
			...chapterThreadList.map(measuredAnchor),
			...(threadDraft?.kind === "thread" && !quotedDraft
				? [{ id: THREAD_COMPOSER_ID, anchor: threadDraft.range, content: null }]
				: []),
		],
		[chapterThreadList, threadDraft, quotedDraft],
	);
	const excerptAttachmentAnchors = useMemo<DiffInlineAttachment[]>(
		() => [
			...chapterQuotedThreads.map(measuredAnchor),
			...(threadDraft?.kind === "thread" && quotedDraft
				? [{ id: THREAD_COMPOSER_ID, anchor: threadDraft.range, content: null }]
				: []),
		],
		[chapterQuotedThreads, threadDraft, quotedDraft],
	);
	const plannedViewportFiles = useMemo<PlannedViewportFile[]>(
		() =>
			planViewportFiles({
				files: viewportFiles,
				width: contentWidth,
				chrome: OPENTUI_DIFF_CHROME,
				syntaxTheme: diffTheme.syntaxTheme,
			}),
		[viewportFiles, contentWidth, diffTheme.syntaxTheme],
	);
	const chapterSegments = useMemo(
		() =>
			viewportSegments({
				files: plannedViewportFiles,
				diagrams: chapterDiagrams,
				excerpts: chapterExcerpts,
				attachments: attachmentAnchors,
				excerptAttachments: excerptAttachmentAnchors,
				attachmentHeight: (id) => attachmentHeights.get(id) ?? ESTIMATED_ATTACHMENT_HEIGHT,
			}),
		[
			plannedViewportFiles,
			chapterDiagrams,
			chapterExcerpts,
			attachmentAnchors,
			excerptAttachmentAnchors,
			attachmentHeights,
		],
	);
	const windowPlan = useMemo(
		() =>
			planWindow({
				segments: chapterSegments,
				scrollTop: Math.max(0, scrollWin.scrollTop - scrollWin.leadingHeight),
				viewportHeight: scrollWin.viewportHeight || height,
				overscan: OVERSCAN_ROWS,
			}),
		[chapterSegments, scrollWin, height],
	);
	const mountedViewportFiles = useMemo(
		() => planViewportBodies({ files: plannedViewportFiles, windowPlan }),
		[plannedViewportFiles, windowPlan],
	);
	const bodyPlans = useMemo(
		() =>
			new Map(
				mountedViewportFiles.flatMap((file) =>
					file.plan ? ([[file.path, file.plan]] as const) : [],
				),
			),
		[mountedViewportFiles],
	);
	// Reveal effects read the current model through refs, so a height correction
	// or replan never re-triggers a scroll on its own.
	const chapterSegmentsRef = useRef(chapterSegments);
	chapterSegmentsRef.current = chapterSegments;
	const chapterExcerptsRef = useRef(chapterExcerpts);
	chapterExcerptsRef.current = chapterExcerpts;
	const viewportFilesRef = useRef(plannedViewportFiles);
	viewportFilesRef.current = plannedViewportFiles;
	const threadsRef = useRef(threads);
	threadsRef.current = threads;
	/**
	 * Where an inline attachment sits in the planned content. Quoted code is measured against its
	 * own excerpt segment: a chapter can both diff and quote one file, and matching an excerpt
	 * anchor against diff rows would scroll to the wrong place.
	 */
	const attachmentOffset = useCallback((anchor: ThreadAnchor, range: DiffLineRange) => {
		if (isExcerptAnchor(anchor)) {
			const excerpt = chapterExcerptsRef.current.find((candidate) =>
				excerptCovers(candidate.plan.quotation, range),
			);
			const row =
				excerpt?.plan.rows.findIndex(
					(entry) => entry.type === "excerpt-line" && entry.lineNumber === range.endLine,
				) ?? -1;
			if (!excerpt || row < 0) return null;
			return segmentOffset(chapterSegmentsRef.current, excerptSegmentId(excerpt.key), row);
		}
		const file = viewportFilesRef.current.find((candidate) => candidate.path === range.filePath);
		if (!file) return null;
		const row = attachmentRowIndex(file, range);
		return row >= 0
			? segmentOffset(chapterSegmentsRef.current, bodySegmentId(file.path), row)
			: null;
	}, []);
	function noteAttachmentNode(id: string, node: { height: number } | null) {
		if (node) attachmentNodes.current.set(id, node);
		else attachmentNodes.current.delete(id);
	}
	// Inline threads are the one row whose height depends on wrapping, so their
	// mounted renderables are measured and the estimates corrected in place.
	useEffect(() => {
		if (!windowingActive) return;
		const timer = setInterval(() => {
			setAttachmentHeights((current) => {
				let next: Map<string, number> | null = null;
				for (const [id, node] of attachmentNodes.current) {
					if (node.height > 0 && current.get(id) !== node.height) {
						next = next ?? new Map(current);
						next.set(id, node.height);
					}
				}
				return next ?? current;
			});
		}, 100);
		return () => clearInterval(timer);
	}, [windowingActive]);

	function updatePreferences(next: Partial<Preferences>) {
		preferencesRef.current = { ...preferencesRef.current, ...next };
		onPreferencesChange?.(preferencesRef.current);
	}
	function changeIndexExpanded(next: boolean) {
		setIndexExpandedState(next);
		updatePreferences({ indexExpanded: next });
	}
	function changeSidebarPreference(next: SidebarPreference) {
		setSidebarPreferenceState(next);
		updatePreferences({ sidebarPreference: next });
	}
	function changeDiffPreference(next: DiffLayoutPreference) {
		setDiffPreferenceState(next);
		updatePreferences({ diffPreference: next });
	}
	function changeLineNumbers(next: boolean) {
		setLineNumbersState(next);
		updatePreferences({ lineNumbers: next });
	}
	function changeChangeMarkers(next: boolean) {
		setChangeMarkersState(next);
		updatePreferences({ changeMarkers: next });
	}
	function changeFileDisplay(next: FileDisplayPreference) {
		setFileDisplayState(next);
		updatePreferences({ fileDisplay: next });
		requestFileFocus();
	}
	function changePathDisplay(next: PathDisplayMode) {
		setPathDisplayState(next);
		updatePreferences({ pathDisplay: next });
	}
	function saveCurrentSession(nextPageId = pageId(page)) {
		const currentPageId = pageId(page);
		const next: ReviewSessionState = {
			...sessionRef.current,
			pageId: nextPageId,
			pages: {
				...sessionRef.current.pages,
				[currentPageId]: {
					selectedFile,
					selectedHunk: selectedHunkIndex,
					selectedKeyChange,
					collapsedFiles: [...collapsedFiles],
					openExcerpts: [...openExcerpts],
					foldedDiagrams: [...foldedDiagrams],
					scrollTop: pageScroll.current?.scrollTop ?? 0,
					panelScrollTop: panelScroll.current?.scrollTop ?? 0,
				},
			},
		};
		sessionRef.current = next;
		onSessionStateChange?.(next);
	}
	function quit() {
		saveCurrentSession();
		onQuit?.();
	}

	useEffect(() => {
		if (!loadFileLines || !chapter) return;
		let live = true;
		for (const path of chapterFilePaths(chapter)) {
			if (fileLines.has(path)) continue;
			loadFileLines(path).then((lines) => {
				if (!live) return;
				setFileLines((previous) =>
					previous.has(path) ? previous : new Map(previous).set(path, lines),
				);
			});
		}
		return () => {
			live = false;
		};
	}, [chapter, loadFileLines, fileLines]);

	useEffect(() => {
		const highlightable = [
			...(diffFiles ?? []),
			...semanticDiffFiles(semantic),
			...expandedVariants.values(),
		];
		if (!highlightable.length || preparedSyntaxTheme === theme.syntaxTheme) return;
		let current = true;
		const syntaxTheme = theme.syntaxTheme;
		prepareSyntaxHighlighting(highlightable, syntaxTheme).then(() => {
			if (current) setPreparedSyntaxTheme(syntaxTheme);
		});
		return () => {
			current = false;
		};
	}, [diffFiles, semantic, expandedVariants, preparedSyntaxTheme, theme.syntaxTheme]);

	useEffect(() => {
		const scroll = pageScroll.current;
		const pending = pendingViewProgress.current;
		if (!scroll || pending?.mode !== viewMode) return;
		const maximum = Math.max(0, scroll.scrollHeight - scroll.viewport.height);
		scroll.scrollTo(Math.round(maximum * pending.progress));
		pendingViewProgress.current = null;
	}, [viewMode]);

	useEffect(() => {
		const restored = sessionRef.current.pages[pageId(pages[current])];
		if (!restored) return;
		const restore = () => {
			pageScroll.current?.scrollTo(restored.scrollTop);
			panelScroll.current?.scrollTo(restored.panelScrollTop);
		};
		restore();
		const retry = setTimeout(restore, 50);
		return () => clearTimeout(retry);
	}, [current, pages]);

	useEffect(() => {
		if (!indexExpanded) return;
		const revealCurrentPage = () => indexScroll.current?.scrollChildIntoView(pageRowId(current));
		revealCurrentPage();
		const retry = setTimeout(revealCurrentPage, 50);
		return () => clearTimeout(retry);
	}, [current, indexExpanded]);

	useEffect(() => {
		if (!chapter || fileFocusRequest === 0) return;
		const path = chapterFilePaths(chapter)[selectedFile];
		const segment = focusedExcerpt
			? excerptSegmentId(focusedExcerpt)
			: path !== undefined
				? headerSegmentId(path)
				: null;
		if (segment !== null) {
			const offset = segmentOffset(chapterSegmentsRef.current, segment);
			if (offset !== null) {
				revealContentOffset({
					scroll: pageScroll.current,
					leadingHeight: leadingContent.current?.height ?? 0,
					offset,
				});
			}
		}
		if (focusedExcerpt) return;
		const anchorFocusedFile = () =>
			pageScroll.current?.scrollChildIntoView(fileHeaderId(chapter.id, selectedFile));
		const retry = setTimeout(anchorFocusedFile, 50);
		const lateRetry = setTimeout(anchorFocusedFile, 150);
		return () => {
			clearTimeout(retry);
			clearTimeout(lateRetry);
		};
	}, [chapter, selectedFile, focusedExcerpt, fileFocusRequest]);

	useEffect(() => {
		if (!chapter || keyFocusRequest === 0 || !chapter.keyChanges.length) return;
		const host = showChapterPanel ? panelScroll : pageScroll;
		const anchorFocusedKeyChange = () =>
			host.current?.scrollChildIntoView(keyChangeId(chapter.id, selectedKeyChange));
		anchorFocusedKeyChange();
		const retry = setTimeout(anchorFocusedKeyChange, 50);
		return () => clearTimeout(retry);
	}, [chapter, selectedKeyChange, keyFocusRequest, showChapterPanel]);

	useEffect(() => {
		if (!diffAnchorTarget) return;
		const file = viewportFilesRef.current.find(
			(candidate) => candidate.path === diffAnchorTarget.path,
		);
		if (file?.measurement) {
			const row = anchorRowIndex(file.measurement, diffAnchorTarget.anchor);
			const offset =
				row >= 0 ? segmentOffset(chapterSegmentsRef.current, bodySegmentId(file.path), row) : null;
			if (offset !== null) {
				centreContentOffset({
					scroll: pageScroll.current,
					leadingHeight: leadingContent.current?.height ?? 0,
					offset,
				});
			}
		}
		const anchorFocusedDiffLine = () =>
			pageScroll.current?.scrollChildIntoView(diffAnchorTarget.id);
		const retry = setTimeout(anchorFocusedDiffLine, 50);
		const lateRetry = setTimeout(anchorFocusedDiffLine, 150);
		return () => {
			clearTimeout(retry);
			clearTimeout(lateRetry);
		};
	}, [diffAnchorTarget]);

	useEffect(() => {
		if (!threadFocusTarget) return;
		const thread = threadsRef.current.find(
			(candidate) => candidate.id === threadFocusTarget.threadId,
		);
		const anchor = threadAnchorRange(thread);
		const offset = thread && anchor ? attachmentOffset(thread.anchor, anchor) : null;
		if (offset !== null) {
			centreContentOffset({
				scroll: pageScroll.current,
				leadingHeight: leadingContent.current?.height ?? 0,
				offset,
				span: ESTIMATED_ATTACHMENT_HEIGHT,
			});
		}
		const revealThread = () => pageScroll.current?.scrollChildIntoView(threadFocusTarget.threadId);
		const retry = setTimeout(revealThread, 50);
		const lateRetry = setTimeout(revealThread, 150);
		return () => {
			clearTimeout(retry);
			clearTimeout(lateRetry);
		};
	}, [threadFocusTarget, attachmentOffset]);

	useEffect(() => {
		if (!copyNotice) return;
		const clear = setTimeout(() => setCopyNotice(null), COPY_NOTICE_MS);
		return () => clearTimeout(clear);
	}, [copyNotice]);

	useEffect(() => () => selectionFlashCleanup.current?.(), []);

	useEffect(() => {
		if (!threadDraft) return;
		const replied =
			threadDraft.kind === "reply"
				? threads.find((thread) => thread.id === threadDraft.threadId)
				: undefined;
		const threadAnchor = threadDraft.kind === "thread" ? threadDraft.anchor : replied?.anchor;
		const anchor = threadDraft.kind === "thread" ? threadDraft.range : threadAnchorRange(replied);
		const offset = threadAnchor && anchor ? attachmentOffset(threadAnchor, anchor) : null;
		if (offset !== null) {
			revealContentOffset({
				scroll: pageScroll.current,
				leadingHeight: leadingContent.current?.height ?? 0,
				offset,
				span: ESTIMATED_ATTACHMENT_HEIGHT + 1,
			});
		}
		const revealThreadComposer = () => pageScroll.current?.scrollChildIntoView(THREAD_COMPOSER_ID);
		const retry = setTimeout(revealThreadComposer, 50);
		const lateRetry = setTimeout(revealThreadComposer, 150);
		return () => {
			clearTimeout(retry);
			clearTimeout(lateRetry);
		};
	}, [threadDraft, threads, attachmentOffset]);

	function previousPathFor(filePath: string) {
		return diffFiles?.find((candidate) => candidate.path === filePath)?.previousPath;
	}
	function copy({ text, notice }: { text: string; notice: string }): boolean {
		const copied = onCopy ? onCopy(text) : copyToClipboard(renderer, text);
		setCopyNotice((current) => ({
			text: copied ? notice : "Could not reach the clipboard",
			nonce: (current?.nonce ?? 0) + 1,
		}));
		return copied;
	}
	function copyLocation(range: DiffLineRange) {
		const text = formatSourceLocation(sourceRangeFor(range, previousPathFor(range.filePath)));
		copy({ text, notice: `Copied location: ${text}` });
	}
	function copyLink(range: DiffLineRange) {
		const text = permalinkFor({
			context: permalinks,
			range,
			previousPath: previousPathFor(range.filePath),
		});
		if (text) copy({ text, notice: `Copied link: ${text}` });
	}
	/** The text the reader dragged over, which OpenTUI tracks separately from the gutter's range. */
	function highlightedText() {
		return renderer.getSelection()?.getSelectedText() || null;
	}
	/** The lines that text runs across, so the pointer's verbs act on the drag rather than one row. */
	function highlightedRange(anchor: DiffLineRange) {
		const selected = renderer.getSelection()?.selectedRenderables ?? [];
		return diffRangeWithin(
			anchor,
			selected.map((renderable) => renderable.id),
		);
	}
	function copyText(text: string) {
		const lines = text.split("\n").length;
		const copied = copy({
			text,
			notice: `Copied ${lines} selected ${lines === 1 ? "line" : "lines"}`,
		});
		if (!copied || !renderer.hasSelection || selectionFlashCleanup.current) return;
		selectionFlashCleanup.current = flashTextSelection({
			renderer,
			theme,
			onFinish: () => {
				selectionFlashCleanup.current = null;
			},
		});
	}
	function openRangeContextMenu(range: DiffLineRange, position: { x: number; y: number }) {
		setCopyNotice(null);
		setContextMenu({
			kind: "range",
			range: highlightedRange(range) ?? range,
			anchorKind: THREAD_ANCHOR_KIND.HUNK,
			position,
			selected: 0,
			selectedText: highlightedText(),
		});
	}
	/** The quoted lines the yank verbs act on when nothing was dragged over the code itself. */
	function excerptSelectionText(range = excerptSelection) {
		return range ? excerptRangeText(chapterExcerpts, range) : null;
	}
	function selectExcerptRange(range: DiffLineRange) {
		setCopyNotice(null);
		setExcerptSelection(range);
	}
	function openExcerptContextMenu(range: DiffLineRange, position: { x: number; y: number }) {
		setCopyNotice(null);
		const resolved = highlightedRange(range) ?? range;
		setExcerptSelection(resolved);
		setContextMenu({
			kind: "range",
			range: resolved,
			anchorKind: THREAD_ANCHOR_KIND.EXCERPT,
			position,
			selected: 0,
			selectedText: highlightedText() ?? excerptSelectionText(resolved),
		});
	}
	function openProseContextMenu(reference: ChapterReference, position: { x: number; y: number }) {
		setCopyNotice(null);
		setContextMenu({
			kind: "prose",
			reference,
			position,
			selected: 0,
			selectedText: highlightedText(),
		});
	}
	function startThread(anchor: ThreadAnchor, range: DiffLineRange) {
		setThreadDraft({ kind: "thread", anchor, range });
		setThreadBody("");
		setThreadNotice(null);
	}
	function selectThreadRange(range: DiffLineRange) {
		setExcerptSelection(null);
		startThread(
			{
				kind: THREAD_ANCHOR_KIND.HUNK,
				filePath: range.filePath,
				oldStart: range.hunkOldStart,
				side: range.side,
				startLine: range.startLine,
				endLine: range.endLine,
			},
			range,
		);
	}
	/**
	 * Quoted code takes its own anchor kind: it belongs to no review unit, so it is keyed to the
	 * run and answers to the frozen context instead. The selection stays tinted under the composer.
	 */
	function commentOnExcerptRange(range: DiffLineRange) {
		setExcerptSelection(range);
		startThread(
			{
				kind: THREAD_ANCHOR_KIND.EXCERPT,
				filePath: range.filePath,
				startLine: range.startLine,
				endLine: range.endLine,
			},
			range,
		);
	}
	function startThreadReply(thread: ReviewThread) {
		setThreadDraft({ kind: "reply", threadId: thread.id, range: diffRangeForThread(thread) });
		setThreadBody("");
		setThreadNotice(null);
	}
	function cancelThreadDraft() {
		setThreadDraft(null);
		setThreadBody("");
		setThreadNotice(null);
		setExcerptSelection(null);
	}
	function saveThreadDraft() {
		if (!threadDraft) return;
		const body = textareaRef.current?.editBuffer.getText() ?? threadBody;
		if (!body.trim()) {
			setThreadNotice("Write a message before saving.");
			return;
		}
		try {
			if (threadDraft.kind === "thread") {
				const anchor = threadDraft.anchor;
				const thread =
					threadActions?.create(anchor, humanAuthor, body) ??
					createThread("0".repeat(64), anchor, humanAuthor, body);
				setThreads((current) => sortThreads([...current, thread]));
			} else {
				const updated =
					threadActions?.reply(threadDraft.threadId, humanAuthor, body) ??
					addThreadReply(threads, threadDraft.threadId, createThreadMessage(humanAuthor, body))
						.updated;
				setThreads((current) =>
					current.map((thread) => (thread.id === updated.id ? updated : thread)),
				);
			}
			cancelThreadDraft();
		} catch (error) {
			setThreadNotice(error instanceof Error ? error.message : String(error));
		}
	}
	function deleteInlineThread(id: string) {
		try {
			threadActions?.delete(id);
			setThreads((current) => current.filter((thread) => thread.id !== id));
			if (threadDraft?.kind === "reply" && threadDraft.threadId === id) cancelThreadDraft();
			setThreadNotice(null);
		} catch (error) {
			setThreadNotice(error instanceof Error ? error.message : String(error));
		}
	}
	function deleteInlineThreadMessage(threadId: string, messageId: string) {
		try {
			threadActions?.deleteMessage(threadId, messageId);
			setThreads((current) =>
				current.map((thread) =>
					thread.id === threadId
						? {
								...thread,
								messages: thread.messages.filter((message) => message.id !== messageId),
							}
						: thread,
				),
			);
			setThreadNotice(null);
		} catch (error) {
			setThreadNotice(error instanceof Error ? error.message : String(error));
		}
	}
	function requestDeleteThread(threadId: string) {
		setConfirmDelete({ kind: "thread", threadId });
	}
	function requestDeleteThreadMessage(threadId: string, messageId: string) {
		setConfirmDelete({ kind: "message", threadId, messageId });
	}
	function confirmPendingDelete() {
		if (!confirmDelete) return;
		if (confirmDelete.kind === "thread") deleteInlineThread(confirmDelete.threadId);
		else deleteInlineThreadMessage(confirmDelete.threadId, confirmDelete.messageId);
		setConfirmDelete(null);
	}
	function toggleInlineThreadStatus(thread: ReviewThread) {
		try {
			const updated =
				thread.status === THREAD_STATUS.OPEN
					? (threadActions?.markDealt(thread.id) ?? {
							...thread,
							status: THREAD_STATUS.DEALT_WITH,
						})
					: (threadActions?.reopen(thread.id) ?? {
							...thread,
							status: THREAD_STATUS.OPEN,
						});
			setThreads((current) =>
				current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
			);
			setThreadNotice(null);
		} catch (error) {
			setThreadNotice(error instanceof Error ? error.message : String(error));
		}
	}
	function restorePageFocus(nextPageId: string) {
		const restored = sessionRef.current.pages[nextPageId] ?? emptyReviewPageState();
		pageScroll.current?.scrollTo(restored.scrollTop);
		panelScroll.current?.scrollTo(restored.panelScrollTop);
		pendingViewProgress.current = null;
		setSelectedFile(restored.selectedFile);
		setSelectedHunkIndex(restored.selectedHunk);
		setSelectedKeyChange(restored.selectedKeyChange);
		setCollapsedFiles(new Set(restored.collapsedFiles));
		setOpenExcerpts(new Set(restored.openExcerpts));
		setFoldedDiagrams(new Set(restored.foldedDiagrams));
		setFocusedExcerpt(null);
		setExpansions(new Map());
		setExpandedVariants(new Map());
		setFileFocusRequest(0);
		setKeyFocusRequest(0);
		setDiffAnchorTarget(null);
		cancelThreadDraft();
	}
	function goto(index: number) {
		const next = Math.max(0, Math.min(index, pages.length - 1));
		if (next === current && !allFiles && !commentsSurface) return;
		const nextPageId = pageId(pages[next]);
		saveCurrentSession(nextPageId);
		setCommentsSurface(false);
		setAllFiles(false);
		setCurrent(next);
		restorePageFocus(nextPageId);
	}
	/** Jump between the story and the whole diff, stage-style — not a page in the sequence. */
	function toggleAllFiles() {
		if (!file) return;
		const nextPageId = pageId(allFiles ? pages[current] : filesPage);
		saveCurrentSession(nextPageId);
		setCommentsSurface(false);
		setAllFiles(!allFiles);
		restorePageFocus(nextPageId);
	}
	/** The centralised thread list — a surface over the review, not a page in it. */
	function toggleComments() {
		if (!commentsSurface) {
			selectSurface("comments");
			return;
		}
		selectSurface(allFiles || !file ? "files" : "story");
	}
	function selectSurface(target: ReviewSurface) {
		if (target === "story" && !file) return;
		if (target === surface) return;
		if (target === "comments") {
			saveCurrentSession(COMMENTS_PAGE_ID);
			setCommentsSurface(true);
			setSelectedThread(0);
			return;
		}
		const nextPageId = pageId(target === "files" ? filesPage : pages[current]);
		saveCurrentSession(nextPageId);
		setCommentsSurface(false);
		setAllFiles(target === "files");
		restorePageFocus(nextPageId);
	}
	function moveThreadSelection(delta: number) {
		if (!orderedThreads.length) return;
		const next = Math.max(0, Math.min(selectedThread + delta, orderedThreads.length - 1));
		setSelectedThread(next);
		pageScroll.current?.scrollChildIntoView(commentRowId(next));
	}
	function jumpToThread(thread: ReviewThread) {
		const chapterIndex = pages.findIndex(
			(candidate) => candidate.kind === "chapter" && chapterOwnsThread(candidate.chapter, thread),
		);
		const nextPage = chapterIndex >= 0 ? pages[chapterIndex] : filesPage;
		const nextPageId = pageId(nextPage);
		saveCurrentSession(nextPageId);
		setCommentsSurface(false);
		setAllFiles(chapterIndex < 0);
		if (chapterIndex >= 0) setCurrent(chapterIndex);
		restorePageFocus(nextPageId);
		const targetChapter =
			nextPage?.kind === "chapter" || nextPage?.kind === "files" ? nextPage.chapter : null;
		if (targetChapter) {
			const fileIndex = chapterFilePaths(targetChapter).indexOf(thread.anchor.filePath);
			if (fileIndex >= 0) {
				setSelectedFile(fileIndex);
				setSelectedHunkIndex(0);
			}
		}
		setCollapsedFiles(
			(currentCollapsed) =>
				new Set([...currentCollapsed].filter((entry) => entry !== thread.anchor.filePath)),
		);
		// A folded excerpt renders none of its threads, so landing on one has to open it.
		const citation = targetChapter ? citationFor(targetChapter, thread) : undefined;
		if (citation) {
			const key = excerptKey(citation);
			setOpenExcerpts((currentOpen) => new Set([...currentOpen, key]));
		}
		setThreadFocusTarget((currentTarget) => ({
			threadId: thread.id,
			request: (currentTarget?.request ?? 0) + 1,
		}));
	}
	function expandContext(
		path: string,
		base: DiffFileInput,
		boundary: number,
		action: ExpandDirection,
	) {
		const lines = fileLines.get(path);
		if (!lines) return;
		const nextExpansion = expandBoundary(
			base.metadata.hunks,
			expansions.get(path),
			lines.length,
			boundary,
			action,
		);
		const parsed = parsePatch(
			expandedPatchText({ file: base, newLines: lines, expansion: nextExpansion }),
			`expanded:${path}`,
		)[0];
		if (!parsed) return;
		void prepareSyntaxHighlighting([parsed], preparedSyntaxTheme).then(() => {
			setExpansions((previous) => new Map(previous).set(path, nextExpansion));
			setExpandedVariants((previous) => new Map(previous).set(path, parsed));
		});
	}
	const contextExpansion: ContextExpansionUi = {
		variantFor: (path) => expandedVariants.get(path),
		expandersFor: (path, base) => {
			const lines = fileLines.get(path);
			if (!lines) return undefined;
			return {
				actionsFor: (boundary) =>
					boundaryActions(base.metadata.hunks, expansions.get(path), lines.length, boundary),
				onExpand: (boundary, action) => expandContext(path, base, boundary, action),
			};
		},
	};
	function gotoChapter(chapter: Chapter) {
		const idx = pages.findIndex((p) => p.kind === "chapter" && p.chapter.id === chapter.id);
		if (idx >= 0) goto(idx);
	}
	function startPanelResize(event: OpenTUIMouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		resizingPanel.current = true;
	}
	function resizePanel(event: OpenTUIMouseEvent) {
		if (!resizingPanel.current) return;
		setRequestedPanelWidthState(resolvePanelWidth(width, event.x + 1));
	}
	// The preference write waits for drag end so resizing never pays a disk
	// write per drag tick.
	function finishPanelResize() {
		if (!resizingPanel.current) return;
		resizingPanel.current = false;
		updatePreferences({ panelWidth: requestedPanelWidth });
	}
	function commit(next: ViewState) {
		setVs(next);
		onViewStateChange?.(next);
	}
	function requestFileFocus() {
		setFileFocusRequest((request) => request + 1);
	}
	function requestKeyFocus() {
		setKeyFocusRequest((request) => request + 1);
	}
	function selectFile(index: number) {
		if (!chapter) return;
		const paths = chapterFilePaths(chapter);
		if (index >= 0 && index < paths.length) {
			setFocusedExcerpt(null);
			setSelectedFile(index);
			setSelectedHunkIndex(0);
			requestFileFocus();
		}
	}
	const toggleMembership = (key: string) => (current: Set<string>) => {
		const next = new Set(current);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};
	/** Figures record the fold rather than the open, so the set stays empty in the common case. */
	function toggleDiagram(key: string) {
		setFoldedDiagrams(toggleMembership(key));
	}
	function toggleExcerpt(key: string) {
		setOpenExcerpts(toggleMembership(key));
		setFocusedExcerpt(key);
	}
	function toggleCollapsedFile(path: string) {
		setCollapsedFiles((currentCollapsed) => {
			const next = new Set(currentCollapsed);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
		requestFileFocus();
	}
	function toggleChapterReview() {
		if (!chapter) return;
		const wasReviewed = isChapterReviewed(vs, chapter.id);
		const next = toggleChapter(vs, chapter);
		commit(next);
		if (!wasReviewed) {
			const target = nextUnreviewedChapter(chapters, next, chapter.order);
			if (target) gotoChapter(target);
		}
	}
	function toggleFileReview(path: string) {
		if (!chapter) return;
		const paths = chapterFilePaths(chapter);
		const fileIndex = paths.indexOf(path);
		if (fileIndex < 0) return;

		const wasReviewed = isFileReviewed(vs, chapter.id, path);
		const next = toggleFile(vs, chapter, path);
		commit(next);

		if (wasReviewed) {
			setSelectedFile(fileIndex);
			setSelectedHunkIndex(0);
			setCollapsedFiles((currentCollapsed) => {
				const expanded = new Set(currentCollapsed);
				expanded.delete(path);
				return expanded;
			});
			requestFileFocus();
			return;
		}

		setCollapsedFiles((currentCollapsed) => new Set(currentCollapsed).add(path));
		if (isChapterReviewed(next, chapter.id)) {
			const target = nextUnreviewedChapter(chapters, next, chapter.order);
			if (target) gotoChapter(target);
			return;
		}

		const nextUnreviewed = paths
			.map((candidate, index) => ({ candidate, index }))
			.filter(({ candidate }) => !isFileReviewed(next, chapter.id, candidate))
			.sort((a, b) => {
				const aDistance = (a.index - fileIndex + paths.length) % paths.length;
				const bDistance = (b.index - fileIndex + paths.length) % paths.length;
				return aDistance - bDistance;
			})[0];
		if (nextUnreviewed) {
			setSelectedFile(nextUnreviewed.index);
			setSelectedHunkIndex(0);
			requestFileFocus();
		}
	}
	function focusChapterKeyChange(targetChapter: Chapter, index: number) {
		if (index < 0 || index >= targetChapter.keyChanges.length) return;
		setSelectedKeyChange(index);
		requestKeyFocus();
		const activeFiles = viewMode === "semantic" ? semanticDiffFiles(semantic) : diffFiles;
		const target = activeFiles
			? findKeyChangeTarget({ chapter: targetChapter, diffFiles: activeFiles, index })
			: null;
		const fallbackPath = targetChapter.keyChanges[index]?.lineRefs[0]?.filePath;
		const fallbackIndex = fallbackPath ? chapterFilePaths(targetChapter).indexOf(fallbackPath) : -1;
		const fileIndex = target?.fileIndex ?? fallbackIndex;
		if (fileIndex < 0) return;
		const path = chapterFilePaths(targetChapter)[fileIndex];
		setSelectedFile(fileIndex);
		setSelectedHunkIndex(target?.hunkIndex ?? 0);
		setCollapsedFiles((current) => new Set([...current].filter((entry) => entry !== path)));
		if (!target) {
			requestFileFocus();
			return;
		}
		setDiffAnchorTarget((current) => ({
			id: target.anchorId,
			path: path ?? target.anchor.filePath,
			anchor: target.anchor,
			request: (current?.request ?? 0) + 1,
		}));
	}
	function focusKeyChange(index: number) {
		if (chapter) focusChapterKeyChange(chapter, index);
	}
	function focusPrologueArea(locations: string[]) {
		const target = findFocusAreaTarget(pages, locations);
		if (!target) return;
		goto(target.pageIndex);
		if (target.keyChangeIndex !== undefined) {
			focusChapterKeyChange(target.chapter, target.keyChangeIndex);
			return;
		}
		setSelectedFile(target.fileIndex);
		setSelectedHunkIndex(0);
		setCollapsedFiles((current) => new Set([...current].filter((entry) => entry !== target.path)));
		requestFileFocus();
	}
	function moveKeyChangeFocus(delta: number) {
		if (!chapter?.keyChanges.length) return;
		const next =
			(selectedKeyChange + delta + chapter.keyChanges.length) % chapter.keyChanges.length;
		focusKeyChange(next);
	}
	function toggleSelectedKeyChange(index: number) {
		if (!chapter || index < 0 || index >= chapter.keyChanges.length) return;
		commit(toggleKeyChange(vs, chapter, index));
	}
	function handleChapterChord(name: string) {
		const prefix = chapterNavigationPrefix.current;
		chapterNavigationPrefix.current = null;
		if (name === "[" || name === "]") {
			chapterNavigationPrefix.current = name;
			return true;
		}
		if (name !== "c" || !prefix) return false;
		movePage(prefix === "]" ? 1 : -1);
		return true;
	}
	function toggleShortcutHelp() {
		setShowHelp((visible) => !visible);
	}
	function movePage(delta: number) {
		goto(current + delta);
	}
	function moveNextUnreviewed() {
		if (!chapter) return;
		const target = nextUnreviewedChapter(chapters, vs, chapter.order);
		if (target) gotoChapter(target);
	}
	function toggleSidebar() {
		changeSidebarPreference(showChapterPanel ? "hidden" : "shown");
	}
	function collapseFiles() {
		if (!chapter) return;
		setCollapsedFiles(new Set(chapterFilePaths(chapter)));
		requestFileFocus();
	}
	function expandFiles() {
		if (!chapter) return;
		setCollapsedFiles(new Set());
		requestFileFocus();
	}
	function changeViewMode(next: "patch" | "semantic") {
		if (next === viewMode) return;
		const scroll = pageScroll.current;
		const maximum = scroll ? Math.max(0, scroll.scrollHeight - scroll.viewport.height) : 0;
		pendingViewProgress.current = {
			mode: next,
			progress: maximum > 0 && scroll ? scroll.scrollTop / maximum : 0,
		};
		setViewModeState(next);
		updatePreferences({ viewMode: next });
	}
	function showPatch() {
		changeViewMode("patch");
	}
	function openThemePicker() {
		const selected = Math.max(
			0,
			pickerThemes.findIndex((candidate) => candidate.id === chosenTheme.id),
		);
		setThemePicker({ selected });
		setPreviewTheme(null);
	}
	function moveThemePreview(delta: number) {
		if (!themePicker) return;
		const selected = (themePicker.selected + delta + pickerThemes.length) % pickerThemes.length;
		setThemePicker({ selected });
		setPreviewTheme(pickerThemes[selected] ?? null);
	}
	function chooseTheme(index: number) {
		const next = pickerThemes[index];
		if (!next) return;
		setChosenTheme(next);
		setPreviewTheme(null);
		setThemePicker(null);
		updatePreferences({ themeId: next.id });
		onThemeChange?.(next);
	}
	function closeThemePicker() {
		setThemePicker(null);
		setPreviewTheme(null);
	}
	async function showSemantic() {
		cancelThreadDraft();
		if (semantic) {
			setSemanticNotice(null);
			changeViewMode("semantic");
			return;
		}
		if (semanticLoading) return;
		if (!loadSemanticDiff) {
			setSemanticNotice(
				"Semantic diff unavailable: no Difftastic loader was supplied. Patch view remains active.",
			);
			return;
		}
		setSemanticLoading(true);
		setSemanticNotice("Loading semantic diff from pinned run snapshots...");
		try {
			const result = prepareSemantic(await loadSemanticDiff());
			await prepareSyntaxHighlighting(semanticDiffFiles(result), theme.syntaxTheme);
			setSemantic(result);
			setSemanticNotice(null);
			changeViewMode("semantic");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			setSemanticNotice(terminalSafe(detail));
			setViewModeState("patch");
			updatePreferences({ viewMode: "patch" });
		} finally {
			setSemanticLoading(false);
		}
	}

	useEffect(() => {
		if (startupViewRestored.current || initialPreferences.viewMode !== "semantic") return;
		startupViewRestored.current = true;
		if (!loadSemanticDiff) {
			setSemanticNotice(
				"Semantic diff unavailable: no Difftastic loader was supplied. Patch view remains active.",
			);
			return;
		}
		setSemanticLoading(true);
		setSemanticNotice("Loading semantic diff from pinned run snapshots...");
		loadSemanticDiff()
			.then(prepareSemantic)
			.then(async (result) => {
				await prepareSyntaxHighlighting(semanticDiffFiles(result), theme.syntaxTheme);
				setSemantic(result);
				setSemanticNotice(null);
				setViewModeState("semantic");
			})
			.catch((error) => {
				const detail = error instanceof Error ? error.message : String(error);
				setSemanticNotice(terminalSafe(detail));
			})
			.finally(() => setSemanticLoading(false));
	}, [initialPreferences.viewMode, loadSemanticDiff, theme.syntaxTheme]);

	const menus = buildAppMenus({
		canMovePrevious: current > 0,
		canMoveNext: current < pages.length - 1,
		canChangeFiles: Boolean(chapter),
		canMoveNextUnreviewed:
			Boolean(chapter) && chapters.some((candidate) => !isChapterReviewed(vs, candidate.id)),
		allFiles: surface === "files",
		canToggleAllFiles: Boolean(file),
		toggleAllFiles,
		commentsSurface,
		toggleComments,
		showHelp,
		viewMode,
		semanticLoading,
		fileDisplay,
		pathDisplay,
		sidebarPreference,
		diffPreference,
		lineNumbers,
		changeMarkers,
		splitReachable,
		setFileDisplay: changeFileDisplay,
		setPathDisplay: changePathDisplay,
		setSidebarPreference: changeSidebarPreference,
		setDiffPreference: changeDiffPreference,
		setLineNumbers: changeLineNumbers,
		setChangeMarkers: changeChangeMarkers,
		requestQuit: quit,
		movePrevious: () => movePage(-1),
		moveNext: () => movePage(1),
		moveNextUnreviewed,
		collapseFiles,
		expandFiles,
		toggleHelp: toggleShortcutHelp,
		showPatch,
		showSemantic: () => void showSemantic(),
		chooseTheme: openThemePicker,
		themeLabel: chosenTheme.label,
		keymap,
	});
	const menu = useMenuController(menus);
	const contextMenuEntries = !contextMenu
		? []
		: contextMenu.kind === "prose"
			? buildProseMenu({
					selectedText: contextMenu.selectedText,
					copyText: () => {
						if (contextMenu.selectedText) copyText(contextMenu.selectedText);
					},
					copyWithReference: () => {
						if (contextMenu.selectedText)
							copy(
								chapterReferenceCopy({
									reference: contextMenu.reference,
									text: contextMenu.selectedText,
								}),
							);
					},
					keymap,
				})
			: buildRangeMenu({
					selectedText: contextMenu.selectedText,
					linkBlocker: permalinkBlocker({ context: permalinks, side: contextMenu.range.side }),
					copyText: () => {
						if (contextMenu.selectedText) copyText(contextMenu.selectedText);
					},
					copyLocation: () => copyLocation(contextMenu.range),
					copyLink: () => copyLink(contextMenu.range),
					comment: () =>
						contextMenu.anchorKind === THREAD_ANCHOR_KIND.EXCERPT
							? commentOnExcerptRange(contextMenu.range)
							: selectThreadRange(contextMenu.range),
					keymap,
				});
	const threadComposer = threadDraft ? (
		<ThreadComposer
			key={threadDraft.kind === "thread" ? "new-thread" : threadDraft.threadId}
			title={threadDraft.kind === "thread" ? "New review thread" : "Reply to thread"}
			body={threadBody}
			notice={threadNotice}
			copyNotice={copyNotice?.text ?? null}
			linkBlocker={permalinkBlocker({ context: permalinks, side: threadDraft.range.side })}
			textareaRef={textareaRef}
			onContentChange={() => setThreadBody(textareaRef.current?.editBuffer.getText() ?? "")}
			onSave={saveThreadDraft}
			onCancel={cancelThreadDraft}
			onCopyLocation={() => copyLocation(threadDraft.range)}
			onCopyLink={() => copyLink(threadDraft.range)}
		/>
	) : undefined;
	const mountedDraft: DiffInlineAttachment | undefined =
		threadDraft?.kind === "thread" && threadComposer
			? {
					id: THREAD_COMPOSER_ID,
					anchor: threadDraft.range,
					content: threadComposer,
				}
			: undefined;
	const newThreadDraft = quotedDraft ? undefined : mountedDraft;
	const newExcerptDraft = quotedDraft ? mountedDraft : undefined;
	const replyDraft =
		threadDraft?.kind === "reply" && threadComposer
			? { threadId: threadDraft.threadId, content: threadComposer }
			: undefined;

	function moveContextMenu(delta: number) {
		setContextMenu((current) =>
			current
				? { ...current, selected: nextMenuItemIndex(contextMenuEntries, current.selected, delta) }
				: current,
		);
	}
	function activateContextMenu(entry = contextMenuEntries[contextMenu?.selected ?? 0]) {
		if (!selectable(entry)) return;
		setContextMenu(null);
		entry.action();
	}

	const appKeys = useMemo(() => deriveAppKeys(keymap), [keymap]);

	useKeyboard((key) => {
		const name = key.name;
		const paths = chapter ? chapterFilePaths(chapter) : [];

		if (confirmDelete) {
			key.preventDefault();
			key.stopPropagation();
			if (name === "escape" || name === "n" || name === "q") setConfirmDelete(null);
			else if (name === "return" || name === "y") confirmPendingDelete();
			return;
		}

		if (contextMenu) {
			key.preventDefault();
			key.stopPropagation();
			if (name === "escape" || name === "q") setContextMenu(null);
			else if (name === "up" || name === "k") moveContextMenu(-1);
			else if (name === "down" || name === "j") moveContextMenu(1);
			else if (name === "return") activateContextMenu();
			return;
		}

		if (threadDraft) {
			if (name === "escape") {
				key.preventDefault();
				key.stopPropagation();
				cancelThreadDraft();
			} else if (name === "return" && key.ctrl) {
				key.preventDefault();
				key.stopPropagation();
				saveThreadDraft();
			}
			return;
		}

		if (appKeys.has(name) || menu.activeMenuId || themePicker || (name && /^[1-9]$/.test(name))) {
			key.preventDefault();
			key.stopPropagation();
		}

		if (themePicker) {
			if (name === "escape" || name === "q") closeThemePicker();
			else if (name === "up" || name === "k") moveThemePreview(-1);
			else if (name === "down" || name === "j") moveThemePreview(1);
			else if (name === "return") chooseTheme(themePicker.selected);
			return;
		}

		if (showHelp && !menu.activeMenuId) {
			if (name === "escape" || name === "?" || name === "q" || name === "f10") setShowHelp(false);
			else if (name === "j" || name === "down") helpScroll.current?.scrollBy(1);
			else if (name === "k" || name === "up") helpScroll.current?.scrollBy(-1);
			else if (name === "pagedown" || name === "pageup")
				helpScroll.current?.scrollBy(name === "pagedown" ? 1 : -1, "viewport");
			return;
		}

		if (menu.activeMenuId) {
			if (name === "escape" || name === "f10") menu.close();
			else if (name === "left" || name === "right") menu.switchMenu(name === "left" ? -1 : 1);
			else if (name === "up" || name === "down") menu.move(name === "up" ? -1 : 1);
			else if (name === "return") menu.activate();
			return;
		}
		const keymapContext = page?.kind === "comments" ? "comments" : "page";
		const actionId = matchKeymapAction(
			keymapContext,
			{
				name: name ?? "",
				ctrl: key.ctrl,
				shift: key.shift,
			},
			keymap,
		);

		if (actionId === "open-menu") {
			chapterNavigationPrefix.current = null;
			menu.open("file");
			return;
		}
		if (actionId === "previous-key-change" || actionId === "next-key-change") {
			moveKeyChangeFocus(actionId === "previous-key-change" ? -1 : 1);
			return;
		}
		if (handleChapterChord(name)) return;
		if (copyNotice) setCopyNotice(null);

		if (name === "escape") {
			quit();
			return;
		}

		if (keymapContext === "comments") {
			switch (actionId) {
				case "quit":
					quit();
					break;
				case "toggle-shortcut-help":
					toggleShortcutHelp();
					break;
				case "open-theme-picker":
					openThemePicker();
					break;
				case "toggle-comments":
					toggleComments();
					break;
				case "comments-select-files":
					selectSurface("files");
					break;
				case "comments-next":
					moveThreadSelection(1);
					break;
				case "comments-previous":
					moveThreadSelection(-1);
					break;
				case "comments-first":
					moveThreadSelection(-orderedThreads.length);
					break;
				case "comments-last":
					moveThreadSelection(orderedThreads.length);
					break;
				case "jump-to-thread": {
					const thread = orderedThreads[selectedThread];
					if (thread) jumpToThread(thread);
					break;
				}
				default:
					break;
			}
			return;
		}

		switch (actionId) {
			case "toggle-shortcut-help":
				toggleShortcutHelp();
				break;
			case "toggle-sidebar":
				toggleSidebar();
				break;
			case "toggle-all-files":
				toggleAllFiles();
				break;
			case "toggle-comments":
				toggleComments();
				break;
			case "cycle-path-display":
				changePathDisplay(nextPathDisplayMode(pathDisplay));
				break;
			case "open-theme-picker":
				openThemePicker();
				break;
			case "copy-selection": {
				const text = highlightedText() ?? excerptSelectionText();
				if (text) copyText(text);
				break;
			}
			case "quit":
				quit();
				break;
			case "page-up":
				pageScroll.current?.scrollBy(-1, "viewport");
				break;
			case "page-down":
				pageScroll.current?.scrollBy(1, "viewport");
				break;
			case "half-page-up":
				pageScroll.current?.scrollBy(-0.5, "viewport");
				break;
			case "half-page-down":
				pageScroll.current?.scrollBy(0.5, "viewport");
				break;
			case "line-up":
				pageScroll.current?.scrollBy(-1);
				break;
			case "line-down":
				pageScroll.current?.scrollBy(1);
				break;
			case "scroll-bottom":
				pageScroll.current?.scrollTo(Number.MAX_SAFE_INTEGER);
				break;
			case "scroll-top":
				pageScroll.current?.scrollTo(0);
				break;
			case "focus-file": {
				if (!focusTargets.length) break;
				const delta = key.shift ? -1 : 1;
				const at = focusedExcerpt
					? focusTargets.findIndex(
							(target) => target.kind === "excerpt" && target.key === focusedExcerpt,
						)
					: focusTargets.findIndex(
							(target) => target.kind === "file" && target.index === selectedFile,
						);
				const next =
					focusTargets[(Math.max(0, at) + delta + focusTargets.length) % focusTargets.length];
				if (!next) break;
				if (next.kind === "file") {
					setFocusedExcerpt(null);
					setSelectedFile(next.index);
				} else setFocusedExcerpt(next.key);
				requestFileFocus();
				break;
			}
			case "toggle-file-diff": {
				if (!chapter) break;
				// A standing quoted selection is what the reviewer is acting on, so Enter comments on
				// it rather than folding the block it sits in.
				if (excerptSelection) {
					commentOnExcerptRange(excerptSelection);
					break;
				}
				if (focusedExcerpt) {
					toggleExcerpt(focusedExcerpt);
					break;
				}
				const path = paths[selectedFile];
				if (path) toggleCollapsedFile(path);
				break;
			}
			case "collapse-files":
				if (chapter) collapseFiles();
				break;
			case "expand-files":
				if (chapter) expandFiles();
				break;
			case "toggle-chapter-review":
				if (chapter) toggleChapterReview();
				break;
			case "toggle-file-review": {
				if (!chapter) break;
				const path = paths[selectedFile];
				if (path) toggleFileReview(path);
				break;
			}
			case "next-unreviewed":
				if (chapter) moveNextUnreviewed();
				break;
			case "toggle-key-change":
				if (chapter) toggleSelectedKeyChange(selectedKeyChange);
				break;
			default:
				if (chapter && name && /^[1-9]$/.test(name)) {
					const idx = Number(name) - 1;
					if (idx < chapter.keyChanges.length) toggleSelectedKeyChange(idx);
				}
		}
	});

	const filesPaths = chapterFilePaths(filesChapter);
	const reviewedFiles = filesPaths.filter((path) =>
		isFileReviewed(vs, ALL_FILES_CHAPTER_ID, path),
	).length;
	const storyProgress = chapters.reduce(
		(acc, c) => {
			const paths = chapterFilePaths(c);
			const chapterDone = isChapterReviewed(vs, c.id);
			return {
				total: acc.total + paths.length,
				reviewed:
					acc.reviewed + paths.filter((p) => chapterDone || isFileReviewed(vs, c.id, p)).length,
			};
		},
		{ total: 0, reviewed: 0 },
	);
	const filesSurface = page?.kind === "files";
	const openThreadCount = threads.filter((thread) => thread.status === THREAD_STATUS.OPEN).length;
	const statusContext =
		page?.kind === "chapter"
			? `Ch ${page.chapter.order}/${chapters.length} · ${page.chapter.title}`
			: (page?.label ?? "revue");
	const configIssuesNotice: StatusNotice | null =
		keymapIssues.length > 0 && themeIssues.length > 0
			? {
					text: `${keymapIssues.length} keybinding + ${themeIssues.length} theme issues ignored — press ? for details`,
					tone: "error",
				}
			: keymapIssues.length > 0
				? {
						text: `${keymapIssues.length} keybinding ${keymapIssues.length === 1 ? "override" : "overrides"} ignored — press ? for details`,
						tone: "error",
					}
				: themeIssues.length > 0
					? {
							text: `${themeIssues.length} theme ${themeIssues.length === 1 ? "issue" : "issues"} ignored — press ? for details`,
							tone: "error",
						}
					: null;
	const statusNotice: StatusNotice | null = threadDraft
		? null
		: threadNotice
			? { text: threadNotice, tone: "error" }
			: copyNotice
				? { text: copyNotice.text, tone: "success" }
				: (configIssuesNotice ?? (syntaxWarning ? { text: syntaxWarning, tone: "error" } : null));

	return (
		<ThemeProvider value={theme}>
			<box
				flexDirection="column"
				width="100%"
				height="100%"
				backgroundColor={theme.background}
				onMouseDrag={resizePanel}
				onMouseDragEnd={finishPanelResize}
				onMouseUp={finishPanelResize}
			>
				<MenuBar
					activeMenuId={menu.activeMenuId}
					terminalWidth={width}
					surface={surface}
					hasStory={Boolean(file)}
					openThreads={openThreadCount}
					onSelectSurface={selectSurface}
					onHover={(id) => {
						if (menu.activeMenuId) menu.open(id);
					}}
					onToggle={(id) => {
						chapterNavigationPrefix.current = null;
						menu.toggle(id);
					}}
					onClose={menu.close}
				/>
				{showChapterPanel || page?.kind === "comments" ? null : (
					<PageNavStrip
						page={page}
						pages={pages}
						current={current}
						chapterCount={chapters.length}
						width={width}
						vs={vs}
						onNavigatePage={goto}
						onToggleChapterReview={toggleChapterReview}
					/>
				)}
				<box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
					{showChapterPanel && page?.kind !== "comments" ? (
						<ChapterPanel
							page={page}
							pages={pages}
							current={current}
							chapterCount={chapters.length}
							coverage={coverage}
							omittedNotice={omittedNotice}
							width={panelWidth}
							vs={vs}
							indexExpanded={indexExpanded}
							selectedFile={selectedFile}
							selectedKeyChange={selectedKeyChange}
							stats={stats}
							pathDisplay={pathDisplay}
							onNavigatePage={goto}
							onToggleIndex={() => changeIndexExpanded(!indexExpanded)}
							onResizeStart={startPanelResize}
							onSelectFile={selectFile}
							onFocusKeyChange={focusKeyChange}
							indexScrollRef={indexScroll}
							scrollRef={panelScroll}
							onToggleChapterReview={toggleChapterReview}
							onToggleFileReview={toggleFileReview}
							onToggleKeyChange={toggleSelectedKeyChange}
							onProseContextMenu={openProseContextMenu}
						/>
					) : null}
					<scrollbox
						id="chapter-viewport"
						ref={pageScroll}
						flexGrow={1}
						flexShrink={1}
						minHeight={0}
						width="100%"
						padding={1}
						scrollY
						viewportCulling
						verticalScrollbarOptions={{
							trackOptions: { foregroundColor: theme.border },
						}}
					>
						<box flexDirection="column" width="100%">
							<box
								flexDirection="column"
								width="100%"
								ref={(node) => {
									leadingContent.current = node;
								}}
							>
								{semanticNotice ? <text fg={theme.badgeModified}>{semanticNotice}</text> : null}
								{chapter && !interlude && viewMode === "semantic" && semantic ? (
									<text fg={theme.muted}>{semantic.version} · semantic view</text>
								) : null}
								{chapter && !showChapterPanel ? (
									<box flexDirection="column" width="100%" paddingBottom={1}>
										<ChapterBrief
											chapter={chapter}
											vs={vs}
											selectedFile={selectedFile}
											selectedKeyChange={selectedKeyChange}
											stats={stats}
											pathDisplay={pathDisplay}
											width={contentWidth}
											onSelectFile={selectFile}
											onFocusKeyChange={focusKeyChange}
											onToggleFileReview={toggleFileReview}
											onToggleKeyChange={toggleSelectedKeyChange}
											onProseContextMenu={openProseContextMenu}
										/>
										<text fg={theme.border}>{"─".repeat(Math.max(1, contentWidth))}</text>
									</box>
								) : null}
							</box>
							{page?.kind === "prologue" ? (
								<PrologueView
									prologue={page.prologue}
									pages={pages}
									vs={vs}
									onSelectPage={goto}
									onSelectFocusArea={focusPrologueArea}
								/>
							) : null}
							{page?.kind === "comments" ? (
								<CommentsView
									threads={orderedThreads}
									selected={selectedThread}
									orphaned={orphanedThreads}
									onJump={jumpToThread}
								/>
							) : null}
							{chapter && plannedBody ? (
								<ChapterView
									chapter={chapter}
									diffTheme={diffTheme}
									diffFiles={diffFiles}
									visibleDiffFiles={visibleChapterFiles}
									bodyPlans={bodyPlans}
									diagrams={chapterDiagrams}
									excerpts={chapterExcerpts}
									focusedExcerpt={focusedExcerpt}
									excerptSelection={excerptSelection}
									windowPlan={windowPlan}
									width={contentWidth}
									contextExpansion={contextExpansion}
									onAttachmentNode={noteAttachmentNode}
									onToggleDiagram={toggleDiagram}
									onToggleExcerpt={toggleExcerpt}
									onSelectExcerptRange={selectExcerptRange}
									onExcerptRangeContextMenu={openExcerptContextMenu}
									vs={vs}
									pathDisplay={pathDisplay}
									selectedFile={selectedFile}
									selectedHunkIndex={selectedHunkIndex}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									threads={threads}
									selectedThreadRange={
										(contextMenu?.kind === "range" &&
										contextMenu.anchorKind === THREAD_ANCHOR_KIND.HUNK
											? contextMenu.range
											: undefined) ?? newThreadDraft?.anchor
									}
									threadDraft={newThreadDraft}
									excerptDraft={newExcerptDraft}
									replyDraft={replyDraft}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
									onSelectThreadRange={selectThreadRange}
									onRangeContextMenu={openRangeContextMenu}
									onReplyThread={startThreadReply}
									onDeleteThread={requestDeleteThread}
									onDeleteThreadMessage={requestDeleteThreadMessage}
									onToggleThreadStatus={toggleInlineThreadStatus}
								/>
							) : null}
							{chapter && !interlude && viewMode === "semantic" && semantic ? (
								<SemanticChapterView
									chapter={chapter}
									semantic={semantic}
									diffTheme={diffTheme}
									diffFiles={diffFiles ?? null}
									bodyPlans={bodyPlans}
									windowPlan={windowPlan}
									width={contentWidth}
									onAttachmentNode={noteAttachmentNode}
									vs={vs}
									pathDisplay={pathDisplay}
									selectedFile={selectedFile}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									threads={threads}
									selectedThreadRange={
										(contextMenu?.kind === "range" &&
										contextMenu.anchorKind === THREAD_ANCHOR_KIND.HUNK
											? contextMenu.range
											: undefined) ?? newThreadDraft?.anchor
									}
									threadDraft={newThreadDraft}
									replyDraft={replyDraft}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
									onSelectThreadRange={selectThreadRange}
									onRangeContextMenu={openRangeContextMenu}
									onReplyThread={startThreadReply}
									onDeleteThread={requestDeleteThread}
									onDeleteThreadMessage={requestDeleteThreadMessage}
									onToggleThreadStatus={toggleInlineThreadStatus}
								/>
							) : null}
							{interlude ? <InterludeClose keymap={keymap} /> : null}
						</box>
					</scrollbox>
				</box>
				{menu.activeMenuId ? (
					<>
						<MenuBackdrop onClose={menu.close} />
						<MenuDropdown
							activeMenuId={menu.activeMenuId}
							entries={menu.activeEntries}
							selectedIndex={menu.activeItemIndex}
							terminalWidth={width}
							onHover={menu.setActiveItemIndex}
							onSelect={menu.activate}
						/>
					</>
				) : null}
				{contextMenu ? (
					<>
						<MenuBackdrop onClose={() => setContextMenu(null)} />
						<ContextMenu
							entries={contextMenuEntries}
							selectedIndex={contextMenu.selected}
							position={contextMenu.position}
							terminalWidth={width}
							terminalHeight={height}
							onHover={(index) =>
								setContextMenu((current) => (current ? { ...current, selected: index } : current))
							}
							onSelect={activateContextMenu}
						/>
					</>
				) : null}
				{confirmDelete ? (
					<ConfirmDialog
						message={
							confirmDelete.kind === "thread" ? "Delete this thread?" : "Delete this message?"
						}
						confirmLabel="Delete"
						terminalWidth={width}
						terminalHeight={height}
						onConfirm={confirmPendingDelete}
						onCancel={() => setConfirmDelete(null)}
					/>
				) : null}
				{showHelp ? (
					<HelpModal
						terminalWidth={width}
						terminalHeight={height}
						scrollRef={helpScroll}
						onClose={() => setShowHelp(false)}
						keymap={keymap}
						issues={keymapIssues}
						themeIssues={themeIssues}
					/>
				) : null}
				{themePicker ? (
					<>
						<ThemePickerBackdrop onClose={closeThemePicker} />
						<ThemePicker
							themes={pickerThemes}
							customThemeIds={customThemeIds}
							selectedIndex={themePicker.selected}
							activeThemeId={chosenTheme.id}
							terminalWidth={width}
							terminalHeight={height}
							onPick={chooseTheme}
						/>
					</>
				) : null}
				<StatusBar
					context={statusContext}
					reviewedFiles={filesSurface ? reviewedFiles : storyProgress.reviewed}
					totalFiles={filesSurface ? filesPaths.length : storyProgress.total}
					coverage={coverage}
					openThreads={openThreadCount}
					viewMode={viewMode}
					notice={statusNotice}
					terminalWidth={width}
				/>
			</box>
		</ThemeProvider>
	);
}

const THEME_MODE_TIMEOUT_MS = 100;

/** Boot the interactive TUI for a loaded run, narrated or not. Resolves when the user quits. */
export async function runApp(
	file: RevueChaptersFile | null,
	options: {
		/** Frozen quotations for the narration's excerpt citations. */
		context?: RunContextFile | null;
		/** What an ignore rule kept out of the prepared run, if anything. */
		omittedNotice?: string | null;
		diffFiles?: DiffFile[] | null;
		loadSemanticDiff?: () => Promise<SemanticDiffResult>;
		loadFileLines?: (path: string) => Promise<string[] | null>;
		initialViewState?: ViewState;
		initialSessionState?: ReviewSessionState;
		initialPreferences?: Preferences;
		initialThreads?: ReviewThread[];
		threadActions?: ThreadActions;
		humanAuthor?: ThreadAuthor;
		permalinks?: PermalinkContext | null;
		/** Resolve the startup theme once the terminal has reported its own background. */
		resolveInitialTheme?: (appearance: Appearance | null) => Theme;
		/** The syntax theme highlights were already prepared for, before the terminal replied. */
		initialSyntaxTheme?: string;
		syntaxWarning?: string;
		transparentSurfaces?: boolean;
		onViewStateChange?: (next: ViewState) => void;
		onSessionStateChange?: (next: ReviewSessionState) => void;
		onPreferencesChange?: (next: Preferences) => void;
		onThemeChange?: (next: Theme) => void;
		/** The registry merged with any `~/.revue/keybindings.json` overrides. */
		keymap?: readonly KeymapAction[];
		/** User keybinding entries dropped during the merge. */
		keymapIssues?: readonly KeymapIssue[];
		/** Themes read from `~/.revue/themes`. */
		customThemes?: readonly Theme[];
		/** Custom theme files or keys dropped while loading. */
		themeIssues?: readonly ThemeIssue[];
	} = {},
): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	const themeMode = await renderer.waitForThemeMode(THEME_MODE_TIMEOUT_MS).catch(() => null);
	const initialTheme =
		options.resolveInitialTheme?.(themeMode) ?? resolveTheme(undefined, themeMode);
	const root = createRoot(renderer);
	let quit = () => {};
	const quitting = new Promise<void>((resolve) => {
		quit = resolve;
	});

	try {
		root.render(
			<App
				file={file}
				context={options.context ?? null}
				diffFiles={options.diffFiles ?? null}
				loadSemanticDiff={options.loadSemanticDiff}
				loadFileLines={options.loadFileLines}
				initialViewState={options.initialViewState}
				initialSessionState={options.initialSessionState}
				initialPreferences={options.initialPreferences}
				initialTheme={initialTheme}
				initialSyntaxTheme={options.initialSyntaxTheme}
				syntaxWarning={options.syntaxWarning}
				transparentSurfaces={options.transparentSurfaces}
				initialThreads={options.initialThreads}
				threadActions={options.threadActions}
				humanAuthor={options.humanAuthor}
				permalinks={options.permalinks}
				onViewStateChange={options.onViewStateChange}
				onSessionStateChange={options.onSessionStateChange}
				onPreferencesChange={options.onPreferencesChange}
				onThemeChange={options.onThemeChange}
				onQuit={quit}
				keymap={options.keymap}
				keymapIssues={options.keymapIssues}
				customThemes={options.customThemes}
				themeIssues={options.themeIssues}
			/>,
		);
		await quitting;
	} finally {
		root.unmount();
		renderer.destroy();
	}
}
