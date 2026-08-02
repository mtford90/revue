// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import {
	createCliRenderer,
	type MouseEvent as OpenTUIMouseEvent,
	type ScrollBoxRenderable,
} from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
	DiffBody,
	type DiffFile,
	DiffFileHeader,
	decorationAnchorId,
	findFocusedDecorationAnchor,
	type RangeDecoration,
} from "@revue/diff-renderer";
import {
	type Chapter,
	emptyViewState,
	type Prologue,
	type RevueChaptersFile,
	type ViewState,
} from "@revue/types";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type FileStat, selectChapterFiles, statsByPath } from "./diff.ts";
import { buildAppMenus, MenuBackdrop, MenuBar, MenuDropdown, useMenuController } from "./menu.tsx";
import { type SemanticDiffResult, terminalSafe } from "./semantic.ts";
import { complexityColor, severityColor, theme } from "./theme.ts";
import {
	chapterFilePaths,
	isChapterReviewed,
	isFileReviewed,
	isKeyChangeChecked,
	nextUnreviewedChapter,
	reviewedChapterCount,
	toggleChapter,
	toggleFile,
	toggleKeyChange,
} from "./viewState.ts";

const CHAPTER_PANEL_MIN_WIDTH = 28;
const CHAPTER_PANEL_DEFAULT_WIDTH_FRACTION = 0.3;
const CHAPTER_PANEL_MAX_WIDTH_FRACTION = 0.5;
const MIN_CHAPTER_PANEL_TERMINAL_WIDTH = Math.ceil(
	CHAPTER_PANEL_MIN_WIDTH / CHAPTER_PANEL_MAX_WIDTH_FRACTION,
);
const MIN_CONTENT_WIDTH = 20;
const MIN_SPLIT_DIFF_WIDTH = 80;
const APP_KEYS = new Set([
	"f10",
	"q",
	"escape",
	"pageup",
	"pagedown",
	"j",
	"k",
	"d",
	"u",
	"b",
	"up",
	"down",
	"g",
	"G",
	"tab",
	"return",
	"c",
	"e",
	"space",
	"x",
	"f",
	"a",
	"[",
	"]",
	"{",
	"}",
	"r",
	"?",
]);
// ── Page model ──────────────────────────────────────────────────────────────
// The reviewer pages through one "beat" at a time: an optional prologue, then
// each chapter in order. This is the core Stage UX, so we own it here and
// compose the Revue renderer's file header and body into collapsible sections.

type Page =
	| { kind: "prologue"; label: string; prologue: Prologue }
	| { kind: "chapter"; label: string; chapter: Chapter };

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

const panelWidthBounds = (terminalWidth: number) => ({
	min: CHAPTER_PANEL_MIN_WIDTH,
	max: Math.max(
		CHAPTER_PANEL_MIN_WIDTH,
		Math.floor(terminalWidth * CHAPTER_PANEL_MAX_WIDTH_FRACTION),
	),
});

const resolvePanelWidth = (terminalWidth: number, requestedWidth: number) => {
	const { min, max } = panelWidthBounds(terminalWidth);
	return Math.min(max, Math.max(min, requestedWidth));
};

const defaultPanelWidth = (terminalWidth: number) =>
	resolvePanelWidth(
		terminalWidth,
		Math.round(terminalWidth * CHAPTER_PANEL_DEFAULT_WIDTH_FRACTION),
	);

function PageList({ pages, current, vs }: { pages: Page[]; current: number; vs: ViewState }) {
	return pages.map((page, index) => {
		const active = index === current;
		const done = page.kind === "chapter" && isChapterReviewed(vs, page.chapter.id);
		const label = page.kind === "chapter" ? `${page.chapter.order}. ${page.label}` : page.label;
		return (
			<text
				key={page.label}
				fg={done ? theme.green : active ? theme.accent : theme.dim}
				wrapMode="none"
				truncate
			>
				{active ? "▸" : " "} {page.kind === "chapter" ? `[${done ? "x" : " "}] ` : ""}
				{label}
			</text>
		);
	});
}

function ChapterPanel({
	page,
	pages,
	current,
	chapterIndex,
	chapterCount,
	width,
	vs,
	selectedFile,
	selectedKeyChange,
	stats,
	reviewed,
	onNavigateChapter,
	onResizeStart,
	onSelectFile,
	onFocusKeyChange,
	scrollRef,
	onToggleChapterReview,
	onToggleFileReview,
	onToggleKeyChange,
}: {
	page: Page | undefined;
	pages: Page[];
	current: number;
	chapterIndex: number;
	chapterCount: number;
	width: number;
	vs: ViewState;
	selectedFile: number;
	selectedKeyChange: number;
	stats: Map<string, FileStat>;
	reviewed: number;
	onNavigateChapter: (index: number) => void;
	onResizeStart: (event: OpenTUIMouseEvent) => void;
	onSelectFile: (index: number) => void;
	onFocusKeyChange: (index: number) => void;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	onToggleChapterReview: () => void;
	onToggleFileReview: (path: string) => void;
	onToggleKeyChange: (index: number) => void;
}) {
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const chapterReviewed = chapter ? isChapterReviewed(vs, chapter.id) : false;

	return (
		<box
			border={["right"]}
			borderColor={theme.surface}
			flexDirection="column"
			width={width}
			flexShrink={0}
			onMouseDown={(event) => {
				if (event.x === width - 1) onResizeStart(event);
			}}
		>
			{chapter ? (
				<>
					<box flexDirection="column" padding={1} gap={1} flexShrink={0}>
						<box flexDirection="row" width="100%">
							<text
								fg={chapterReviewed ? theme.green : theme.dim}
								onMouseDown={onToggleChapterReview}
							>
								[{chapterReviewed ? "x" : " "}]
							</text>
							<text
								fg={chapterIndex > 0 ? theme.accent : theme.surface}
								onMouseDown={() => onNavigateChapter(chapterIndex - 1)}
							>
								‹
							</text>
							<box flexGrow={1} justifyContent="center">
								<text fg={theme.text}>
									Chapter {chapter.order}/{chapterCount}
								</text>
							</box>
							<text
								fg={chapterIndex < chapterCount - 1 ? theme.accent : theme.surface}
								onMouseDown={() => onNavigateChapter(chapterIndex + 1)}
							>
								›
							</text>
						</box>
						<text fg={theme.accent}>{chapter.title}</text>
					</box>
					<text fg={theme.surface}>{"─".repeat(Math.max(1, width - 1))}</text>
					<scrollbox
						ref={scrollRef}
						flexGrow={1}
						flexShrink={1}
						minHeight={0}
						padding={1}
						scrollY
						viewportCulling
					>
						<box flexDirection="column" width="100%">
							<text fg={theme.dim}>{chapter.summary}</text>
							<KeyChanges
								chapter={chapter}
								vs={vs}
								selected={selectedKeyChange}
								onFocus={onFocusKeyChange}
								onToggle={onToggleKeyChange}
							/>
							<text fg={theme.surface}>{"─".repeat(Math.max(1, width - 3))}</text>
							<FileList
								chapter={chapter}
								vs={vs}
								selected={selectedFile}
								stats={stats}
								onSelect={onSelectFile}
								onToggleReview={onToggleFileReview}
							/>
						</box>
					</scrollbox>
				</>
			) : (
				<box flexDirection="column" flexGrow={1} padding={1} gap={1}>
					<text fg={theme.accent}>revue</text>
					<text fg={theme.mauve}>Chapters</text>
					<PageList pages={pages} current={current} vs={vs} />
				</box>
			)}
			<text fg={theme.dim} flexShrink={0} paddingLeft={1} paddingRight={1}>
				{reviewed}/{chapterCount} reviewed
			</text>
		</box>
	);
}

// ── Prologue ────────────────────────────────────────────────────────────────
function PrologueView({ prologue }: { prologue: Prologue }) {
	return (
		<box flexDirection="column" gap={1}>
			{prologue.motivation ? <text fg={theme.text}>{prologue.motivation}</text> : null}
			{prologue.outcome ? <text fg={theme.green}>→ {prologue.outcome}</text> : null}
			<text fg={complexityColor[prologue.complexity.level] ?? theme.text}>
				complexity: {prologue.complexity.level} — {prologue.complexity.reasoning}
			</text>

			{prologue.keyChanges.length ? (
				<box flexDirection="column">
					<text fg={theme.mauve}>What changed</text>
					{prologue.keyChanges.map((kc) => (
						<text key={kc.summary} fg={theme.text}>
							• {kc.summary} — {kc.description}
						</text>
					))}
				</box>
			) : null}

			{prologue.focusAreas.length ? (
				<box flexDirection="column">
					<text fg={theme.mauve}>Worth a look</text>
					{prologue.focusAreas.map((fa) => (
						<text key={fa.title} fg={severityColor[fa.severity] ?? theme.text}>
							[{fa.severity}] {fa.type}: {fa.title} — {fa.description}
						</text>
					))}
				</box>
			) : null}

			{prologue.diagram ? (
				<box flexDirection="column" border borderColor={theme.surface} title=" diagram (mermaid) ">
					<text fg={theme.dim}>{prologue.diagram}</text>
				</box>
			) : null}
		</box>
	);
}

// ── Chapter file list (review state belongs to Revue's shell) ─────────────────
function FileList({
	chapter,
	vs,
	selected,
	stats,
	onSelect,
	onToggleReview,
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	stats: Map<string, FileStat>;
	onSelect: (index: number) => void;
	onToggleReview: (path: string) => void;
}) {
	const paths = chapterFilePaths(chapter);
	return (
		<box flexDirection="column">
			<text fg={theme.mauve}>Files ({paths.length})</text>
			{paths.map((path, index) => {
				const done = isFileReviewed(vs, chapter.id, path);
				const active = index === selected;
				const stat = stats.get(path);
				const counts = stat ? `  +${stat.additions} -${stat.deletions}` : "";
				return (
					<box key={path} flexDirection="row" width="100%">
						<text fg={active ? theme.accent : theme.dim}>{active ? "▸" : " "} </text>
						<text fg={done ? theme.green : theme.dim} onMouseDown={() => onToggleReview(path)}>
							[{done ? "x" : " "}]
						</text>
						<text
							fg={active ? theme.accent : done ? theme.green : theme.dim}
							wrapMode="none"
							truncate
							onMouseDown={() => onSelect(index)}
						>
							{path}
							{counts}
						</text>
					</box>
				);
			})}
		</box>
	);
}

// ── Chapter key changes (checkable) ───────────────────────────────────────────
const keyChangeId = (chapterId: string, index: number) =>
	`chapter-key-change:${chapterId}:${index}`;

type KeyChangeTarget = { fileIndex: number; hunkIndex: number; anchorId: string };

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
			};
		}
	}
	return null;
};

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
	if (!chapter.keyChanges.length) return null;
	return (
		<box flexDirection="column">
			<text fg={theme.yellow}>What to review</text>
			{chapter.keyChanges.map((kc, i) => {
				const checked = isKeyChangeChecked(vs, chapter.id, i);
				const active = i === selected;
				return (
					<box id={keyChangeId(chapter.id, i)} key={kc.content} flexDirection="row">
						<text fg={active ? theme.accent : theme.dim}>{active ? "▸" : " "} </text>
						<text
							fg={checked ? theme.green : theme.dim}
							onMouseDown={(event) => {
								event.stopPropagation();
								onToggle(i);
							}}
						>
							[{checked ? "x" : " "}]
						</text>
						<text
							fg={active ? theme.accent : checked ? theme.green : theme.text}
							onMouseDown={() => onFocus(i)}
						>
							{i + 1}. {kc.content}
						</text>
					</box>
				);
			})}
		</box>
	);
}

// ── Chapter detail ────────────────────────────────────────────────────────────
const fileHeaderId = (chapterId: string, index: number) =>
	`chapter-file-header:${chapterId}:${index}`;

function ChapterView({
	chapter,
	diffFiles,
	width,
	vs,
	selectedFile,
	selectedHunkIndex,
	selectedKeyChange,
	collapsedFiles,
	onSelectFile,
	onToggleCollapse,
	onToggleFileReview,
}: {
	chapter: Chapter;
	diffFiles: DiffFile[] | null;
	width: number;
	vs: ViewState;
	selectedFile: number;
	selectedHunkIndex: number;
	selectedKeyChange: number;
	collapsedFiles: Set<string>;
	onSelectFile: (index: number) => void;
	onToggleCollapse: (path: string) => void;
	onToggleFileReview: (path: string) => void;
}) {
	const chapterDiffFiles = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];
	const paths = chapterFilePaths(chapter);
	const layout = width >= MIN_SPLIT_DIFF_WIDTH ? "split" : "stack";
	const focusedDecorationId = `key-change:${chapter.id}:${selectedKeyChange}`;
	const decorations: RangeDecoration[] = (
		chapter.keyChanges[selectedKeyChange]?.lineRefs ?? []
	).map((ref, refIndex) => ({
		...ref,
		id: `${focusedDecorationId}:${refIndex}`,
		focusId: focusedDecorationId,
	}));

	return (
		<box flexDirection="column" gap={1}>
			{chapterDiffFiles.length ? (
				<box flexDirection="column" width="100%">
					{chapterDiffFiles.map((diffFile, streamIndex) => {
						const path = diffFile.chapterPath;
						const fileIndex = paths.indexOf(path);
						const focused = fileIndex === selectedFile;
						const collapsed = collapsedFiles.has(path);
						const reviewed = isFileReviewed(vs, chapter.id, path);
						return (
							<box key={diffFile.id} flexDirection="column" width="100%">
								{streamIndex > 0 ? (
									<text fg={theme.surface}>{"─".repeat(Math.max(1, width - 2))}</text>
								) : null}
								<box
									id={fileHeaderId(chapter.id, fileIndex)}
									flexDirection="row"
									height={1}
									width="100%"
								>
									<text fg={focused ? theme.accent : theme.dim}>{focused ? "▸" : " "}</text>
									<text
										fg={reviewed ? theme.green : theme.dim}
										onMouseDown={() => onToggleFileReview(path)}
									>
										[{reviewed ? "x" : " "}]
									</text>
									<text
										fg={focused ? theme.accent : theme.dim}
										onMouseDown={() => onToggleCollapse(path)}
									>
										{collapsed ? "▶" : "▼"}
									</text>
									<box flexGrow={1} minWidth={0}>
										<DiffFileHeader
											file={diffFile}
											width={Math.max(1, width - 7)}
											onSelect={() => onSelectFile(fileIndex)}
										/>
									</box>
								</box>
								{collapsed ? null : (
									<DiffBody
										file={diffFile}
										layout={layout}
										width={width}
										showLineNumbers
										selectedHunkIndex={focused ? selectedHunkIndex : -1}
										decorations={decorations}
										focusedDecorationId={focusedDecorationId}
									/>
								)}
							</box>
						);
					})}
				</box>
			) : null}
		</box>
	);
}

// ── Read-only semantic view ────────────────────────────────────────────────
const keyedSemanticLines = (lines: string[]) => {
	const occurrences = new Map<string, number>();
	return lines.map((line) => {
		const occurrence = occurrences.get(line) ?? 0;
		occurrences.set(line, occurrence + 1);
		return { key: `${line}:${occurrence}`, line };
	});
};

function SemanticChapterView({
	chapter,
	semantic,
	vs,
	selectedFile,
	collapsedFiles,
	onSelectFile,
	onToggleCollapse,
	onToggleFileReview,
}: {
	chapter: Chapter;
	semantic: SemanticDiffResult;
	vs: ViewState;
	selectedFile: number;
	collapsedFiles: Set<string>;
	onSelectFile: (index: number) => void;
	onToggleCollapse: (path: string) => void;
	onToggleFileReview: (path: string) => void;
}) {
	const paths = chapterFilePaths(chapter);
	const files = paths.flatMap((path) => {
		const file = semantic.files.find((candidate) => candidate.path === path);
		return file ? [file] : [];
	});
	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.yellow}>
				Read-only semantic view · key-change anchors, exact range highlights, and comments are
				Patch-only
			</text>
			<text fg={theme.dim}>{semantic.version}</text>
			{files.map((file, streamIndex) => {
				const fileIndex = paths.indexOf(file.path);
				const focused = fileIndex === selectedFile;
				const collapsed = collapsedFiles.has(file.path);
				const reviewed = isFileReviewed(vs, chapter.id, file.path);
				const lines = keyedSemanticLines(file.lines);
				return (
					<box key={file.path} flexDirection="column" width="100%">
						{streamIndex > 0 ? <text fg={theme.surface}>{"─".repeat(20)}</text> : null}
						<box
							id={fileHeaderId(chapter.id, fileIndex)}
							flexDirection="row"
							height={1}
							width="100%"
						>
							<text fg={focused ? theme.accent : theme.dim}>{focused ? "▸" : " "}</text>
							<text
								fg={reviewed ? theme.green : theme.dim}
								onMouseDown={() => onToggleFileReview(file.path)}
							>
								[{reviewed ? "x" : " "}]
							</text>
							<text
								fg={focused ? theme.accent : theme.dim}
								onMouseDown={() => onToggleCollapse(file.path)}
							>
								{collapsed ? "▶" : "▼"} {file.path}
							</text>
						</box>
						{collapsed ? null : (
							<box flexDirection="column" paddingLeft={1}>
								{lines.map(({ key, line }, index) => (
									<text
										key={`${file.path}:${key}`}
										fg={index === 0 ? theme.mauve : theme.text}
										wrapMode="word"
										onMouseDown={() => onSelectFile(fileIndex)}
									>
										{line || " "}
									</text>
								))}
							</box>
						)}
					</box>
				);
			})}
		</box>
	);
}

// ── Keyboard help ──────────────────────────────────────────────────────────
function ShortcutHelp() {
	return (
		<box flexDirection="column" width="100%" flexShrink={0}>
			<text fg={theme.accent}>Keyboard shortcuts</text>
			<text fg={theme.mauve}>Scrolling</text>
			<text fg={theme.text}> j/k or ↑/↓ line</text>
			<text fg={theme.text}> d/u or ctrl-d/ctrl-u half-page</text>
			<text fg={theme.text}> space/ctrl-f page down · b/ctrl-b page up</text>
			<text fg={theme.text}> g/gg top · G bottom · PgUp/PgDn · wheel</text>
			<text fg={theme.mauve}>Navigation</text>
			<text fg={theme.text}> ]c/[c next/previous chapter</text>
			<text fg={theme.text}> a next unreviewed</text>
			<text fg={theme.mauve}>Files</text>
			<text fg={theme.text}> tab/shift-tab focus · enter toggle diff</text>
			<text fg={theme.text}> c/e collapse/expand all</text>
			<text fg={theme.mauve}>Review</text>
			<text fg={theme.text}> x chapter · f focused file</text>
			<text fg={theme.text}> {"{/}"} focus key change · r toggle · 1–9 direct</text>
			<text fg={theme.mauve}>Views</text>
			<text fg={theme.text}> F10 → View toggles Patch / read-only Semantic</text>
			<text fg={theme.dim}> anchors, exact range highlights, and comments are Patch-only</text>
			<text fg={theme.mauve}>Menu/help/quit</text>
			<text fg={theme.text}> F10 menu · ? close · q/esc quit</text>
		</box>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
export function App({
	file,
	diffFiles = null,
	loadSemanticDiff,
	initialViewState = emptyViewState(),
	onViewStateChange,
	onQuit,
}: {
	file: RevueChaptersFile;
	diffFiles?: DiffFile[] | null;
	loadSemanticDiff?: (width: number) => Promise<SemanticDiffResult>;
	initialViewState?: ViewState;
	onViewStateChange?: (next: ViewState) => void;
	onQuit?: () => void;
}) {
	const pages = buildPages(file);
	const chapters = pages.flatMap((candidate) =>
		candidate.kind === "chapter" ? [candidate.chapter] : [],
	);
	const [current, setCurrent] = useState(0);
	const [selectedFile, setSelectedFile] = useState(0);
	const [selectedHunkIndex, setSelectedHunkIndex] = useState(0);
	const [selectedKeyChange, setSelectedKeyChange] = useState(0);
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
	const [fileFocusRequest, setFileFocusRequest] = useState(0);
	const [keyFocusRequest, setKeyFocusRequest] = useState(0);
	const [diffAnchorTarget, setDiffAnchorTarget] = useState<{ id: string; request: number } | null>(
		null,
	);
	const [showHelp, setShowHelp] = useState(false);
	const [viewMode, setViewMode] = useState<"patch" | "semantic">("patch");
	const [semantic, setSemantic] = useState<SemanticDiffResult | null>(null);
	const [semanticLoading, setSemanticLoading] = useState(false);
	const [semanticNotice, setSemanticNotice] = useState<string | null>(null);
	const [vs, setVs] = useState(initialViewState);
	const pageScroll = useRef<ScrollBoxRenderable>(null);
	const modeScroll = useRef<Record<"patch" | "semantic", number>>({ patch: 0, semantic: 0 });
	const panelScroll = useRef<ScrollBoxRenderable>(null);
	const resizingPanel = useRef(false);
	const chapterNavigationPrefix = useRef<"[" | "]" | null>(null);
	const { width } = useTerminalDimensions();
	const [requestedPanelWidth, setRequestedPanelWidth] = useState(() => defaultPanelWidth(width));
	const panelWidth = resolvePanelWidth(width, requestedPanelWidth);
	const showChapterPanel = width >= MIN_CHAPTER_PANEL_TERMINAL_WIDTH;
	const contentWidth = Math.max(MIN_CONTENT_WIDTH, width - (showChapterPanel ? panelWidth : 0) - 4);
	const page = pages[current];
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const chapterIndex = chapter
		? chapters.findIndex((candidate) => candidate.id === chapter.id)
		: -1;
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();

	useEffect(() => {
		pageScroll.current?.scrollTo(modeScroll.current[viewMode]);
	}, [viewMode]);

	useEffect(() => {
		if (!chapter || fileFocusRequest === 0) return;
		const anchorFocusedFile = () =>
			pageScroll.current?.scrollChildIntoView(fileHeaderId(chapter.id, selectedFile));
		anchorFocusedFile();
		const retry = setTimeout(anchorFocusedFile, 50);
		return () => clearTimeout(retry);
	}, [chapter, selectedFile, fileFocusRequest]);

	useEffect(() => {
		if (!chapter || keyFocusRequest === 0 || !chapter.keyChanges.length) return;
		const anchorFocusedKeyChange = () =>
			panelScroll.current?.scrollChildIntoView(keyChangeId(chapter.id, selectedKeyChange));
		anchorFocusedKeyChange();
		const retry = setTimeout(anchorFocusedKeyChange, 50);
		return () => clearTimeout(retry);
	}, [chapter, selectedKeyChange, keyFocusRequest]);

	useEffect(() => {
		if (!diffAnchorTarget) return;
		const anchorFocusedDiffLine = () =>
			pageScroll.current?.scrollChildIntoView(diffAnchorTarget.id);
		anchorFocusedDiffLine();
		const retry = setTimeout(anchorFocusedDiffLine, 50);
		return () => clearTimeout(retry);
	}, [diffAnchorTarget]);

	function goto(index: number) {
		const next = Math.max(0, Math.min(index, pages.length - 1));
		if (next === current) return;
		pageScroll.current?.scrollTo(0);
		modeScroll.current = { patch: 0, semantic: 0 };
		setCurrent(next);
		setSelectedFile(0);
		setSelectedHunkIndex(0);
		setSelectedKeyChange(0);
		setCollapsedFiles(new Set());
		setFileFocusRequest(0);
		setKeyFocusRequest(0);
		setDiffAnchorTarget(null);
	}
	function gotoChapter(chapter: Chapter) {
		const idx = pages.findIndex((p) => p.kind === "chapter" && p.chapter.id === chapter.id);
		if (idx >= 0) goto(idx);
	}
	function gotoChapterIndex(index: number) {
		const target = chapters[index];
		if (target) gotoChapter(target);
	}
	function startPanelResize(event: OpenTUIMouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		resizingPanel.current = true;
	}
	function resizePanel(event: OpenTUIMouseEvent) {
		if (!resizingPanel.current) return;
		setRequestedPanelWidth(resolvePanelWidth(width, event.x + 1));
	}
	function finishPanelResize() {
		resizingPanel.current = false;
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
			setSelectedFile(index);
			setSelectedHunkIndex(0);
			requestFileFocus();
		}
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
	function focusKeyChange(index: number) {
		if (!chapter || index < 0 || index >= chapter.keyChanges.length) return;
		setSelectedKeyChange(index);
		requestKeyFocus();
		if (viewMode !== "patch" || !diffFiles) return;
		const target = findKeyChangeTarget({ chapter, diffFiles, index });
		if (!target) return;
		setSelectedFile(target.fileIndex);
		setSelectedHunkIndex(target.hunkIndex);
		setDiffAnchorTarget((current) => ({
			id: target.anchorId,
			request: (current?.request ?? 0) + 1,
		}));
		const path = chapterFilePaths(chapter)[target.fileIndex];
		setCollapsedFiles((current) => new Set([...current].filter((entry) => entry !== path)));
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
		gotoChapterIndex(chapterIndex + (prefix === "]" ? 1 : -1));
		return true;
	}
	function toggleShortcutHelp() {
		pageScroll.current?.scrollTo(0);
		setShowHelp((visible) => !visible);
	}
	function moveChapter(delta: number) {
		gotoChapterIndex(chapterIndex + delta);
	}
	function moveNextUnreviewed() {
		if (!chapter) return;
		const target = nextUnreviewedChapter(chapters, vs, chapter.order);
		if (target) gotoChapter(target);
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
		modeScroll.current[viewMode] = pageScroll.current?.scrollTop ?? 0;
		setViewMode(next);
	}
	function showPatch() {
		changeViewMode("patch");
	}
	async function showSemantic() {
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
		modeScroll.current.patch = pageScroll.current?.scrollTop ?? 0;
		setSemanticLoading(true);
		setSemanticNotice("Loading read-only semantic diff from pinned run snapshots...");
		try {
			const result = await loadSemanticDiff(contentWidth);
			setSemantic(result);
			setSemanticNotice(null);
			setViewMode("semantic");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			setSemanticNotice(terminalSafe(detail));
			setViewMode("patch");
		} finally {
			setSemanticLoading(false);
		}
	}

	const menus = buildAppMenus({
		canMovePrevious: chapterIndex > 0,
		canMoveNext: chapterIndex < chapters.length - 1,
		canChangeFiles: Boolean(chapter),
		canMoveNextUnreviewed:
			Boolean(chapter) && chapters.some((candidate) => !isChapterReviewed(vs, candidate.id)),
		showHelp,
		viewMode,
		semanticLoading,
		requestQuit: () => onQuit?.(),
		movePrevious: () => moveChapter(-1),
		moveNext: () => moveChapter(1),
		moveNextUnreviewed,
		collapseFiles,
		expandFiles,
		toggleHelp: toggleShortcutHelp,
		showPatch,
		showSemantic: () => void showSemantic(),
	});
	const menu = useMenuController(menus);

	useKeyboard((key) => {
		const name = key.name;
		const paths = chapter ? chapterFilePaths(chapter) : [];

		if (APP_KEYS.has(name) || menu.activeMenuId || (name && /^[1-9]$/.test(name))) {
			key.preventDefault();
			key.stopPropagation();
		}

		if (menu.activeMenuId) {
			if (name === "escape" || name === "f10") menu.close();
			else if (name === "left" || name === "right") menu.switchMenu(name === "left" ? -1 : 1);
			else if (name === "up" || name === "down") menu.move(name === "up" ? -1 : 1);
			else if (name === "return") menu.activate();
			return;
		}
		if (name === "f10") {
			chapterNavigationPrefix.current = null;
			menu.open("file");
			return;
		}

		const previousKeyChange = name === "{" || (name === "[" && key.shift);
		const nextKeyChange = name === "}" || (name === "]" && key.shift);
		if (previousKeyChange || nextKeyChange) {
			moveKeyChangeFocus(previousKeyChange ? -1 : 1);
			return;
		}
		if (handleChapterChord(name)) return;

		if (name === "?") {
			toggleShortcutHelp();
		} else if (name === "q" || name === "escape") {
			onQuit?.();
		} else if (name === "pageup" || name === "pagedown") {
			pageScroll.current?.scrollBy(name === "pageup" ? -1 : 1, "viewport");
		} else if ((name === "f" || name === "b") && key.ctrl) {
			pageScroll.current?.scrollBy(name === "f" ? 1 : -1, "viewport");
		} else if (name === "d" || name === "u") {
			pageScroll.current?.scrollBy(name === "d" ? 0.5 : -0.5, "viewport");
		} else if (name === "space" || name === "b") {
			pageScroll.current?.scrollBy(name === "space" ? 1 : -1, "viewport");
		} else if (name === "j" || name === "down") {
			pageScroll.current?.scrollBy(1);
		} else if (name === "k" || name === "up") {
			pageScroll.current?.scrollBy(-1);
		} else if (name === "G" || (name === "g" && key.shift)) {
			pageScroll.current?.scrollTo(Number.MAX_SAFE_INTEGER);
		} else if (name === "g") {
			pageScroll.current?.scrollTo(0);
		} else if (name === "tab") {
			if (paths.length) {
				const delta = key.shift ? -1 : 1;
				setSelectedFile((selected) => (selected + delta + paths.length) % paths.length);
				requestFileFocus();
			}
		} else if (!chapter) {
			// remaining keys act on a chapter only
		} else if (name === "return") {
			const path = paths[selectedFile];
			if (path) toggleCollapsedFile(path);
		} else if (name === "c") {
			collapseFiles();
		} else if (name === "e") {
			expandFiles();
		} else if (name === "x") {
			toggleChapterReview();
		} else if (name === "f") {
			const path = paths[selectedFile];
			if (path) toggleFileReview(path);
		} else if (name === "a") {
			moveNextUnreviewed();
		} else if (name === "r") {
			toggleSelectedKeyChange(selectedKeyChange);
		} else if (name && /^[1-9]$/.test(name)) {
			const idx = Number(name) - 1;
			if (idx < chapter.keyChanges.length) toggleSelectedKeyChange(idx);
		}
	});

	const reviewed = reviewedChapterCount(vs, chapters);

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			onMouseDrag={resizePanel}
			onMouseDragEnd={finishPanelResize}
			onMouseUp={finishPanelResize}
		>
			<MenuBar
				activeMenuId={menu.activeMenuId}
				terminalWidth={width}
				viewMode={viewMode}
				onHover={(id) => {
					if (menu.activeMenuId) menu.open(id);
				}}
				onToggle={(id) => {
					chapterNavigationPrefix.current = null;
					menu.toggle(id);
				}}
				onClose={menu.close}
			/>
			<box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
				{showChapterPanel ? (
					<ChapterPanel
						page={page}
						pages={pages}
						current={current}
						chapterIndex={chapterIndex}
						chapterCount={chapters.length}
						width={panelWidth}
						vs={vs}
						selectedFile={selectedFile}
						selectedKeyChange={selectedKeyChange}
						stats={stats}
						reviewed={reviewed}
						onNavigateChapter={gotoChapterIndex}
						onResizeStart={startPanelResize}
						onSelectFile={selectFile}
						onFocusKeyChange={focusKeyChange}
						scrollRef={panelScroll}
						onToggleChapterReview={toggleChapterReview}
						onToggleFileReview={toggleFileReview}
						onToggleKeyChange={toggleSelectedKeyChange}
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
						trackOptions: { foregroundColor: theme.surface },
					}}
				>
					{showHelp ? (
						<ShortcutHelp />
					) : (
						<box flexDirection="column" width="100%">
							{semanticNotice ? <text fg={theme.yellow}>{semanticNotice}</text> : null}
							{page?.kind === "prologue" ? <PrologueView prologue={page.prologue} /> : null}
							{page?.kind === "chapter" && viewMode === "patch" ? (
								<ChapterView
									chapter={page.chapter}
									diffFiles={diffFiles}
									width={contentWidth}
									vs={vs}
									selectedFile={selectedFile}
									selectedHunkIndex={selectedHunkIndex}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
								/>
							) : null}
							{page?.kind === "chapter" && viewMode === "semantic" && semantic ? (
								<SemanticChapterView
									chapter={page.chapter}
									semantic={semantic}
									vs={vs}
									selectedFile={selectedFile}
									collapsedFiles={collapsedFiles}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
								/>
							) : null}
						</box>
					)}
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
			<box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="column">
				<text fg={theme.dim}>
					{`${current + 1}/${pages.length} · j/k scroll · d/u half-page · space/b page · g/G top/bottom`}
				</text>
				<text fg={theme.dim}>
					{viewMode === "semantic"
						? "Semantic is read-only · anchors/ranges/comments Patch-only · F10 View to switch"
						: "F10 menu · ]c/[c chapter · tab file · f review file · x review chapter · ? help · q quit"}
				</text>
			</box>
		</box>
	);
}

/** Boot the interactive TUI for a loaded chapters file. Resolves when the user quits. */
export async function runApp(
	file: RevueChaptersFile,
	options: {
		diffFiles?: DiffFile[] | null;
		loadSemanticDiff?: (width: number) => Promise<SemanticDiffResult>;
		initialViewState?: ViewState;
		onViewStateChange?: (next: ViewState) => void;
	} = {},
): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	const root = createRoot(renderer);
	let quit = () => {};
	const quitting = new Promise<void>((resolve) => {
		quit = resolve;
	});

	try {
		root.render(
			<App
				file={file}
				diffFiles={options.diffFiles ?? null}
				loadSemanticDiff={options.loadSemanticDiff}
				initialViewState={options.initialViewState}
				onViewStateChange={options.onViewStateChange}
				onQuit={quit}
			/>,
		);
		await quitting;
	} finally {
		root.unmount();
		renderer.destroy();
	}
}
