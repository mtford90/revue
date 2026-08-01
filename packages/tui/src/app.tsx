// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
	type Chapter,
	emptyViewState,
	type Prologue,
	type RevueChaptersFile,
	type ViewState,
} from "@revue/types";
import { HunkDiffBody, type HunkDiffFile, HunkDiffFileHeader } from "hunkdiff/opentui";
import { useEffect, useRef, useState } from "react";
import { type FileStat, selectChapterFiles, statsByPath } from "./diff.ts";
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

const SIDEBAR_WIDTH = 34;
const MIN_SPLIT_DIFF_WIDTH = 80;
const APP_KEYS = new Set([
	"q",
	"escape",
	"pageup",
	"pagedown",
	"j",
	"k",
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
	"r",
	"?",
]);
const HUNK_THEME = "catppuccin-mocha" as const;

// ── Page model ──────────────────────────────────────────────────────────────
// The reviewer pages through one "beat" at a time: an optional prologue, then
// each chapter in order. This is the core Stage UX that hunk's file-oriented nav
// doesn't provide, so we own it here and compose hunk's exported file header
// and diff body primitives into collapsible sections (see ChapterView).

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

// ── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({
	pages,
	current,
	vs,
	reviewed,
	total,
}: {
	pages: Page[];
	current: number;
	vs: ViewState;
	reviewed: number;
	total: number;
}) {
	return (
		<box
			border
			borderColor={theme.surface}
			title=" revue "
			titleAlignment="left"
			flexDirection="column"
			width={SIDEBAR_WIDTH}
			padding={1}
		>
			<box flexDirection="column" flexGrow={1}>
				{pages.map((page, i) => {
					const active = i === current;
					const done = page.kind === "chapter" && isChapterReviewed(vs, page.chapter.id);
					const label =
						page.kind === "chapter" ? `${page.chapter.order}. ${page.label}` : page.label;
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
				})}
			</box>
			<text fg={theme.dim}>
				{reviewed}/{total} reviewed
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

// ── Chapter file list (our own — HunkFileNav can't show a reviewed checkbox) ──
function FileList({
	chapter,
	vs,
	selected,
	stats,
	onToggle,
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	stats: Map<string, FileStat>;
	onToggle: (path: string) => void;
}) {
	const paths = chapterFilePaths(chapter);
	return (
		<box flexDirection="column">
			<text fg={theme.mauve}>Files ({paths.length}) — f toggles focused</text>
			{paths.map((path, i) => {
				const done = isFileReviewed(vs, chapter.id, path);
				const active = i === selected;
				const stat = stats.get(path);
				const counts = stat ? `  +${stat.additions} -${stat.deletions}` : "";
				return (
					<text
						key={path}
						fg={active ? theme.accent : done ? theme.green : theme.dim}
						onMouseDown={() => onToggle(path)}
					>
						{active ? "▸" : " "} [{done ? "x" : " "}] {path}
						{counts}
					</text>
				);
			})}
		</box>
	);
}

// ── Chapter key changes (checkable) ───────────────────────────────────────────
const keyChangeId = (chapterId: string, index: number) =>
	`chapter-key-change:${chapterId}:${index}`;

function KeyChanges({
	chapter,
	vs,
	selected,
	onToggle,
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	onToggle: (index: number) => void;
}) {
	if (!chapter.keyChanges.length) return null;
	return (
		<box flexDirection="column">
			<text fg={theme.yellow}>Key changes — [ / ] focus · r toggle · 1–9 direct</text>
			{chapter.keyChanges.map((kc, i) => {
				const checked = isKeyChangeChecked(vs, chapter.id, i);
				const active = i === selected;
				return (
					<text
						id={keyChangeId(chapter.id, i)}
						key={kc.content}
						fg={active ? theme.accent : checked ? theme.green : theme.text}
						onMouseDown={() => onToggle(i)}
					>
						{active ? "▸" : " "} [{checked ? "x" : " "}] {i + 1}. {kc.content}
					</text>
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
	selectedKeyChange,
	collapsedFiles,
	onSelectFile,
	onToggleCollapse,
	onToggleChapterReview,
	onToggleFileReview,
	onToggleKeyChange,
}: {
	chapter: Chapter;
	diffFiles: HunkDiffFile[] | null;
	width: number;
	vs: ViewState;
	selectedFile: number;
	selectedKeyChange: number;
	collapsedFiles: Set<string>;
	onSelectFile: (index: number) => void;
	onToggleCollapse: (path: string) => void;
	onToggleChapterReview: () => void;
	onToggleFileReview: (path: string) => void;
	onToggleKeyChange: (index: number) => void;
}) {
	const chapterDiffFiles = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();
	const paths = chapterFilePaths(chapter);
	const layout = width >= MIN_SPLIT_DIFF_WIDTH ? "split" : "stack";

	const chapterReviewed = isChapterReviewed(vs, chapter.id);

	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.accent}>{chapter.title}</text>
			<text fg={chapterReviewed ? theme.green : theme.accent} onMouseDown={onToggleChapterReview}>
				▸ [{chapterReviewed ? "x" : " "}] Chapter reviewed — space/x toggles
			</text>
			<text fg={theme.text}>{chapter.summary}</text>

			<FileList
				chapter={chapter}
				vs={vs}
				selected={selectedFile}
				stats={stats}
				onToggle={onToggleFileReview}
			/>
			<KeyChanges
				chapter={chapter}
				vs={vs}
				selected={selectedKeyChange}
				onToggle={onToggleKeyChange}
			/>

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
									<text
										fg={focused ? theme.accent : reviewed ? theme.green : theme.dim}
										onMouseDown={() => onToggleFileReview(path)}
									>
										{focused ? "▸" : " "}[{reviewed ? "x" : " "}]
									</text>
									<text fg={focused ? theme.accent : theme.dim}>{collapsed ? "▶" : "▼"}</text>
									<box flexGrow={1} minWidth={0}>
										<HunkDiffFileHeader
											file={diffFile}
											width={Math.max(1, width - 7)}
											theme={HUNK_THEME}
											onSelect={() => {
												onSelectFile(fileIndex);
												onToggleCollapse(path);
											}}
										/>
									</box>
								</box>
								{collapsed ? null : (
									<HunkDiffBody
										file={diffFile}
										layout={layout}
										width={width}
										theme={HUNK_THEME}
										showLineNumbers
										selectedHunkIndex={focused ? 0 : -1}
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

// ── Keyboard help ──────────────────────────────────────────────────────────
function ShortcutHelp() {
	return (
		<box flexDirection="column" width="100%" flexShrink={0}>
			<text fg={theme.accent}>Keyboard shortcuts</text>
			<text fg={theme.mauve}>Navigation</text>
			<text fg={theme.text}> j/k or ↑/↓ chapters</text>
			<text fg={theme.text}> g/G first/last</text>
			<text fg={theme.text}> a next unreviewed</text>
			<text fg={theme.mauve}>Files</text>
			<text fg={theme.text}> tab/shift-tab focus</text>
			<text fg={theme.text}> enter toggle diff</text>
			<text fg={theme.mauve}>Scrolling</text>
			<text fg={theme.text}> PgUp/PgDn · wheel</text>
			<text fg={theme.mauve}>Collapse</text>
			<text fg={theme.text}> c/e all file diffs</text>
			<text fg={theme.mauve}>Review</text>
			<text fg={theme.text}> space/x chapter</text>
			<text fg={theme.text}> f focused file</text>
			<text fg={theme.text}> [/] key focus</text>
			<text fg={theme.text}> r toggle key · 1–9 direct</text>
			<text fg={theme.mauve}>Help/quit</text>
			<text fg={theme.text}> ? close · q/esc quit</text>
		</box>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
export function App({
	file,
	diffFiles = null,
	initialViewState = emptyViewState(),
	onViewStateChange,
	onQuit,
}: {
	file: RevueChaptersFile;
	diffFiles?: HunkDiffFile[] | null;
	initialViewState?: ViewState;
	onViewStateChange?: (next: ViewState) => void;
	onQuit?: () => void;
}) {
	const pages = buildPages(file);
	const chapters = file.chapters;
	const [current, setCurrent] = useState(0);
	const [selectedFile, setSelectedFile] = useState(0);
	const [selectedKeyChange, setSelectedKeyChange] = useState(0);
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
	const [fileFocusRequest, setFileFocusRequest] = useState(0);
	const [keyFocusRequest, setKeyFocusRequest] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const [vs, setVs] = useState(initialViewState);
	const pageScroll = useRef<ScrollBoxRenderable>(null);
	const { width } = useTerminalDimensions();
	const contentWidth = Math.max(20, width - SIDEBAR_WIDTH - 4);
	const page = pages[current];
	const chapter = page?.kind === "chapter" ? page.chapter : null;

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
			pageScroll.current?.scrollChildIntoView(keyChangeId(chapter.id, selectedKeyChange));
		anchorFocusedKeyChange();
		const retry = setTimeout(anchorFocusedKeyChange, 50);
		return () => clearTimeout(retry);
	}, [chapter, selectedKeyChange, keyFocusRequest]);

	function goto(index: number) {
		const next = Math.max(0, Math.min(index, pages.length - 1));
		if (next === current) return;
		pageScroll.current?.scrollTo(0);
		setCurrent(next);
		setSelectedFile(0);
		setSelectedKeyChange(0);
		setCollapsedFiles(new Set());
		setFileFocusRequest(0);
		setKeyFocusRequest(0);
	}
	function gotoChapter(chapter: Chapter) {
		const idx = pages.findIndex((p) => p.kind === "chapter" && p.chapter.id === chapter.id);
		if (idx >= 0) goto(idx);
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
			requestFileFocus();
		}
	}
	function selectKeyChange(index: number) {
		if (!chapter || index < 0 || index >= chapter.keyChanges.length) return;
		setSelectedKeyChange(index);
		requestKeyFocus();
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
			requestFileFocus();
		}
	}
	function toggleSelectedKeyChange(index: number) {
		if (!chapter || index < 0 || index >= chapter.keyChanges.length) return;
		setSelectedKeyChange(index);
		commit(toggleKeyChange(vs, chapter, index));
		requestKeyFocus();
	}

	useKeyboard((key) => {
		const name = key.name;
		const paths = chapter ? chapterFilePaths(chapter) : [];

		if (APP_KEYS.has(name) || (name && /^[1-9]$/.test(name))) {
			key.preventDefault();
			key.stopPropagation();
		}

		if (name === "?") {
			pageScroll.current?.scrollTo(0);
			setShowHelp((visible) => !visible);
		} else if (name === "q" || name === "escape") {
			onQuit?.();
		} else if (name === "pageup" || name === "pagedown") {
			pageScroll.current?.scrollBy(name === "pageup" ? -1 : 1, "viewport");
		} else if (name === "j" || name === "down") {
			goto(current + 1);
		} else if (name === "k" || name === "up") {
			goto(current - 1);
		} else if (name === "g") {
			goto(0);
		} else if (name === "G") {
			goto(pages.length - 1);
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
			setCollapsedFiles(new Set(paths));
			requestFileFocus();
		} else if (name === "e") {
			setCollapsedFiles(new Set());
			requestFileFocus();
		} else if (name === "space" || name === "x") {
			toggleChapterReview();
		} else if (name === "f") {
			const path = paths[selectedFile];
			if (path) toggleFileReview(path);
		} else if (name === "a") {
			const target = nextUnreviewedChapter(chapters, vs, chapter.order);
			if (target) gotoChapter(target);
		} else if (name === "[" || name === "]") {
			const count = chapter.keyChanges.length;
			if (count) {
				const delta = name === "[" ? -1 : 1;
				selectKeyChange((selectedKeyChange + delta + count) % count);
			}
		} else if (name === "r") {
			toggleSelectedKeyChange(selectedKeyChange);
		} else if (name && /^[1-9]$/.test(name)) {
			const idx = Number(name) - 1;
			if (idx < chapter.keyChanges.length) toggleSelectedKeyChange(idx);
		}
	});

	const reviewed = reviewedChapterCount(vs, chapters);

	return (
		<box flexDirection="column" width="100%" height="100%">
			<box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
				<Sidebar
					pages={pages}
					current={current}
					vs={vs}
					reviewed={reviewed}
					total={chapters.length}
				/>
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
							{page?.kind === "prologue" ? <PrologueView prologue={page.prologue} /> : null}
							{page?.kind === "chapter" ? (
								<ChapterView
									chapter={page.chapter}
									diffFiles={diffFiles}
									width={contentWidth}
									vs={vs}
									selectedFile={selectedFile}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleChapterReview={toggleChapterReview}
									onToggleFileReview={toggleFileReview}
									onToggleKeyChange={toggleSelectedKeyChange}
								/>
							) : null}
						</box>
					)}
				</scrollbox>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="column">
				<text fg={theme.dim}>
					{`${current + 1}/${pages.length} · j/k chapter · tab file · f review file · space review chapter`}
				</text>
				<text fg={theme.dim}>
					PgUp/PgDn or wheel scroll · [/] + r key changes · ? help · q quit
				</text>
			</box>
		</box>
	);
}

/** Boot the interactive TUI for a loaded chapters file. Resolves when the user quits. */
export async function runApp(
	file: RevueChaptersFile,
	options: {
		diffFiles?: HunkDiffFile[] | null;
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
