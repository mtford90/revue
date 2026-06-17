import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
	type Chapter,
	emptyViewState,
	type Prologue,
	type RevueChaptersFile,
	type ViewState,
} from "@revue/types";
import { type HunkDiffFile, HunkReviewStream } from "hunkdiff/opentui";
import { useState } from "react";
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
const HUNK_THEME = "catppuccin-mocha" as const;

// ── Page model ──────────────────────────────────────────────────────────────
// The reviewer pages through one "beat" at a time: an optional prologue, then
// each chapter in order. This is the core Stage UX that hunk's file-oriented nav
// doesn't provide, so we own it here and delegate each chapter's diff body to
// hunk's <HunkReviewStream> (see ChapterView).

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
					const mark = done ? "✔" : active ? "▸" : " ";
					const label =
						page.kind === "chapter" ? `${page.chapter.order}. ${page.label}` : page.label;
					return (
						<text key={page.label} fg={done ? theme.green : active ? theme.accent : theme.dim}>
							{mark} {label}
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
}: {
	chapter: Chapter;
	vs: ViewState;
	selected: number;
	stats: Map<string, FileStat>;
}) {
	const paths = chapterFilePaths(chapter);
	return (
		<box flexDirection="column">
			<text fg={theme.mauve}>Files ({paths.length})</text>
			{paths.map((path, i) => {
				const done = isFileReviewed(vs, chapter.id, path);
				const active = i === selected;
				const stat = stats.get(path);
				const counts = stat ? `  +${stat.additions} -${stat.deletions}` : "";
				return (
					<text key={path} fg={active ? theme.accent : done ? theme.green : theme.dim}>
						{active ? "▸" : " "} [{done ? "✔" : " "}] {path}
						{counts}
					</text>
				);
			})}
		</box>
	);
}

// ── Chapter key changes (checkable) ───────────────────────────────────────────
function KeyChanges({ chapter, vs }: { chapter: Chapter; vs: ViewState }) {
	if (!chapter.keyChanges.length) return null;
	return (
		<box flexDirection="column">
			<text fg={theme.yellow}>Key changes — needs a human call</text>
			{chapter.keyChanges.map((kc, i) => {
				const checked = isKeyChangeChecked(vs, chapter.id, i);
				return (
					<text key={kc.content} fg={checked ? theme.green : theme.text}>
						[{checked ? "✔" : " "}] {i + 1}. {kc.content}
					</text>
				);
			})}
		</box>
	);
}

// ── Chapter detail ────────────────────────────────────────────────────────────
function ChapterView({
	chapter,
	diffFiles,
	width,
	vs,
	selectedFile,
}: {
	chapter: Chapter;
	diffFiles: HunkDiffFile[] | null;
	width: number;
	vs: ViewState;
	selectedFile: number;
}) {
	const selected = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();

	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.accent}>{chapter.title}</text>
			<text fg={theme.text}>{chapter.summary}</text>

			<FileList chapter={chapter} vs={vs} selected={selectedFile} stats={stats} />
			<KeyChanges chapter={chapter} vs={vs} />

			{selected.length ? (
				<HunkReviewStream
					files={selected}
					width={width}
					theme={HUNK_THEME}
					showFileHeaders
					showLineNumbers
				/>
			) : null}
		</box>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
export function App({
	file,
	diffFiles = null,
	initialViewState = emptyViewState(),
	onViewStateChange,
}: {
	file: RevueChaptersFile;
	diffFiles?: HunkDiffFile[] | null;
	initialViewState?: ViewState;
	onViewStateChange?: (next: ViewState) => void;
}) {
	const pages = buildPages(file);
	const chapters = file.chapters;
	const [current, setCurrent] = useState(0);
	const [selectedFile, setSelectedFile] = useState(0);
	const [vs, setVs] = useState(initialViewState);
	const { width } = useTerminalDimensions();
	const contentWidth = Math.max(20, width - SIDEBAR_WIDTH - 4);

	function goto(index: number) {
		setCurrent(Math.max(0, Math.min(index, pages.length - 1)));
		setSelectedFile(0);
	}
	function gotoChapter(chapter: Chapter) {
		const idx = pages.findIndex((p) => p.kind === "chapter" && p.chapter.id === chapter.id);
		if (idx >= 0) goto(idx);
	}
	function commit(next: ViewState) {
		setVs(next);
		onViewStateChange?.(next);
	}

	useKeyboard((key) => {
		const name = key.name;
		const page = pages[current];
		const chapter = page?.kind === "chapter" ? page.chapter : null;
		const paths = chapter ? chapterFilePaths(chapter) : [];

		if (name === "q" || name === "escape") {
			process.exit(0);
		} else if (name === "j" || name === "down") {
			goto(current + 1);
		} else if (name === "k" || name === "up") {
			goto(current - 1);
		} else if (name === "g") {
			goto(0);
		} else if (name === "G") {
			goto(pages.length - 1);
		} else if (name === "tab") {
			if (paths.length) setSelectedFile((s) => (s + 1) % paths.length);
		} else if (!chapter) {
			// remaining keys act on a chapter only
		} else if (name === "space" || name === "x") {
			const next = toggleChapter(vs, chapter);
			commit(next);
			if (isChapterReviewed(next, chapter.id)) {
				const target = nextUnreviewedChapter(chapters, next, chapter.order);
				if (target) gotoChapter(target);
			}
		} else if (name === "f") {
			const path = paths[selectedFile];
			if (path) commit(toggleFile(vs, chapter, path));
		} else if (name === "a") {
			const target = nextUnreviewedChapter(chapters, vs, chapter.order);
			if (target) gotoChapter(target);
		} else if (name && /^[1-9]$/.test(name)) {
			const idx = Number(name) - 1;
			if (idx < chapter.keyChanges.length) commit(toggleKeyChange(vs, chapter, idx));
		}
	});

	const page = pages[current];
	const reviewed = reviewedChapterCount(vs, chapters);

	return (
		<box flexDirection="column" width="100%" height="100%">
			<box flexDirection="row" flexGrow={1}>
				<Sidebar
					pages={pages}
					current={current}
					vs={vs}
					reviewed={reviewed}
					total={chapters.length}
				/>
				<box flexGrow={1} padding={1} flexDirection="column">
					{page?.kind === "prologue" ? <PrologueView prologue={page.prologue} /> : null}
					{page?.kind === "chapter" ? (
						<ChapterView
							chapter={page.chapter}
							diffFiles={diffFiles}
							width={contentWidth}
							vs={vs}
							selectedFile={selectedFile}
						/>
					) : null}
				</box>
			</box>
			<box paddingLeft={1} paddingRight={1}>
				<text fg={theme.dim}>
					j/k move · tab file · f file done · space chapter done · 1-9 key · a next unreviewed · q
					quit — {current + 1}/{pages.length}
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
	createRoot(renderer).render(
		<App
			file={file}
			diffFiles={options.diffFiles ?? null}
			initialViewState={options.initialViewState}
			onViewStateChange={options.onViewStateChange}
		/>,
	);
	// The renderer keeps the event loop alive; quitting calls process.exit.
	await new Promise<void>(() => {});
}
