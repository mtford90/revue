import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Chapter, Prologue, RevueChaptersFile } from "@revue/types";
import { type HunkDiffFile, HunkReviewStream } from "hunkdiff/opentui";
import { useState } from "react";
import { selectChapterFiles } from "./diff.ts";
import { complexityColor, severityColor, theme } from "./theme.ts";

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
		pages.push({ kind: "chapter", label: `${chapter.order}. ${chapter.title}`, chapter });
	}
	return pages;
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ pages, current }: { pages: Page[]; current: number }) {
	return (
		<box
			border
			borderColor={theme.surface}
			title=" revue "
			titleAlignment="left"
			flexDirection="column"
			width={34}
			padding={1}
		>
			{pages.map((page, i) => {
				const active = i === current;
				return (
					<text key={page.label} fg={active ? theme.accent : theme.dim}>
						{active ? "▸ " : "  "}
						{page.label}
					</text>
				);
			})}
		</box>
	);
}

// ── Content panes ───────────────────────────────────────────────────────────
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

function ChapterView({
	chapter,
	diffFiles,
	width,
}: {
	chapter: Chapter;
	diffFiles: HunkDiffFile[] | null;
	width: number;
}) {
	const selected = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];

	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.accent}>{chapter.title}</text>
			<text fg={theme.text}>{chapter.summary}</text>

			{selected.length ? (
				<HunkReviewStream
					files={selected}
					width={width}
					theme={HUNK_THEME}
					showFileHeaders
					showLineNumbers
				/>
			) : (
				<box flexDirection="column">
					<text fg={theme.mauve}>Hunks ({chapter.hunkRefs.length})</text>
					{chapter.hunkRefs.map((h) => (
						<text key={`${h.filePath}:${h.oldStart}`} fg={theme.dim}>
							{h.filePath}:{h.oldStart}
						</text>
					))}
				</box>
			)}

			{chapter.keyChanges.length ? (
				<box flexDirection="column">
					<text fg={theme.yellow}>Key changes — needs a human call</text>
					{chapter.keyChanges.map((kc) => (
						<text key={kc.content} fg={theme.text}>
							? {kc.content}
						</text>
					))}
				</box>
			) : null}
		</box>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
export function App({
	file,
	diffFiles = null,
}: {
	file: RevueChaptersFile;
	diffFiles?: HunkDiffFile[] | null;
}) {
	const pages = buildPages(file);
	const [current, setCurrent] = useState(0);
	const { width } = useTerminalDimensions();
	// content pane = total width minus the sidebar and the panes' borders/padding.
	const contentWidth = Math.max(20, width - SIDEBAR_WIDTH - 4);

	useKeyboard((key) => {
		const name = key.name;
		if (name === "q" || name === "escape") {
			process.exit(0);
		} else if (name === "j" || name === "down") {
			setCurrent((c) => Math.min(c + 1, pages.length - 1));
		} else if (name === "k" || name === "up") {
			setCurrent((c) => Math.max(c - 1, 0));
		} else if (name === "g") {
			setCurrent(0);
		} else if (name === "G") {
			setCurrent(pages.length - 1);
		}
	});

	const page = pages[current];

	return (
		<box flexDirection="column" width="100%" height="100%">
			<box flexDirection="row" flexGrow={1}>
				<Sidebar pages={pages} current={current} />
				<box flexGrow={1} padding={1} flexDirection="column">
					{page?.kind === "prologue" ? <PrologueView prologue={page.prologue} /> : null}
					{page?.kind === "chapter" ? (
						<ChapterView chapter={page.chapter} diffFiles={diffFiles} width={contentWidth} />
					) : null}
				</box>
			</box>
			<box paddingLeft={1} paddingRight={1}>
				<text fg={theme.dim}>
					j/k or ↑/↓ move · g/G first/last · q quit — {current + 1}/{pages.length}
				</text>
			</box>
		</box>
	);
}

/** Boot the interactive TUI for a loaded chapters file. Resolves when the user quits. */
export async function runApp(
	file: RevueChaptersFile,
	diffFiles: HunkDiffFile[] | null = null,
): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	createRoot(renderer).render(<App file={file} diffFiles={diffFiles} />);
	// The renderer keeps the event loop alive; quitting calls process.exit.
	await new Promise<void>(() => {});
}
