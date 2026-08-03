// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import {
	createCliRenderer,
	createTextAttributes,
	type MouseEvent as OpenTUIMouseEvent,
	type ScrollBoxRenderable,
	type TextareaRenderable,
} from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
	DiffBody,
	type DiffFile,
	DiffFileHeader,
	type DiffInlineAttachment,
	type DiffLayout,
	type DiffLineRange,
	decorationAnchorId,
	findFocusedDecorationAnchor,
	type RangeDecoration,
} from "@revue/diff-renderer";
import {
	type Chapter,
	emptyViewState,
	type Prologue,
	type ReviewThread,
	type RevueChaptersFile,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	type ThreadAuthor,
	type ThreadMessage,
	type ViewState,
} from "@revue/types";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { type ChapterDiffFile, type FileStat, selectChapterFiles, statsByPath } from "./diff.ts";
import { Narration } from "./markdown.tsx";
import { buildAppMenus, MenuBackdrop, MenuBar, MenuDropdown, useMenuController } from "./menu.tsx";
import { type SemanticDiffResult, terminalSafe } from "./semantic.ts";
import { complexityColor, severityColor, theme } from "./theme.ts";
import { addThreadReply, createThread, createThreadMessage, sortThreads } from "./threads.ts";
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
const PANEL_INDEX_MAX_ROWS = 8;
const COMPACT_NAV_WIDTH = 34;
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
	return pages.map((page, index) => {
		const active = index === current;
		const done = page.kind === "chapter" && isChapterReviewed(vs, page.chapter.id);
		const label = page.kind === "chapter" ? `${page.chapter.order}. ${page.label}` : page.label;
		return (
			<box
				key={page.label}
				id={pageRowId(index)}
				height={1}
				width="100%"
				flexDirection="row"
				backgroundColor={active ? theme.surface : undefined}
				onMouseDown={() => onSelect(index)}
			>
				<text flexShrink={0} fg={active ? theme.accent : theme.surface}>
					{active ? "▸" : " "}
				</text>
				<text flexShrink={0} fg={done ? theme.green : theme.dim}>
					{page.kind === "chapter" ? `[${done ? "x" : " "}] ` : "    "}
				</text>
				<text
					flexGrow={1}
					minWidth={0}
					wrapMode="none"
					truncate
					fg={active ? theme.accent : done ? theme.green : theme.dim}
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
			verticalScrollbarOptions={{ trackOptions: { foregroundColor: theme.surface } }}
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
	return (
		<box
			height={1}
			flexShrink={0}
			backgroundColor={enabled ? theme.surface : undefined}
			onMouseDown={(event) => {
				event.stopPropagation();
				if (enabled) onPress();
			}}
		>
			<text fg={enabled ? theme.accent : theme.dim}>{` ${label} `}</text>
		</box>
	);
}

function ChapterPanel({
	page,
	pages,
	current,
	chapterCount,
	width,
	vs,
	indexExpanded,
	selectedFile,
	selectedKeyChange,
	stats,
	reviewed,
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
}: {
	page: Page | undefined;
	pages: Page[];
	current: number;
	chapterCount: number;
	width: number;
	vs: ViewState;
	indexExpanded: boolean;
	selectedFile: number;
	selectedKeyChange: number;
	stats: Map<string, FileStat>;
	reviewed: number;
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
}) {
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const chapterReviewed = chapter ? isChapterReviewed(vs, chapter.id) : false;
	const compact = width < COMPACT_NAV_WIDTH;
	const rule = "─".repeat(Math.max(1, width - 1));

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
			<box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
				<text flexShrink={0} fg={theme.accent}>
					revue
				</text>
				<box flexGrow={1} minWidth={0} />
				<text flexShrink={0} fg={theme.dim}>
					{reviewed}/{chapterCount} reviewed
				</text>
			</box>
			<box
				flexDirection="row"
				height={1}
				flexShrink={0}
				paddingLeft={1}
				paddingRight={1}
				onMouseDown={onToggleIndex}
			>
				<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.mauve}>
					{indexExpanded ? "▾" : "▸"} Chapters ({chapterCount})
				</text>
			</box>
			{indexExpanded ? (
				<PageIndex
					pages={pages}
					current={current}
					vs={vs}
					onSelect={onNavigatePage}
					scrollRef={indexScrollRef}
				/>
			) : null}
			<text flexShrink={0} fg={theme.surface}>
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
							fg={chapterReviewed ? theme.green : theme.dim}
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
			{chapter ? (
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					flexShrink={1}
					minHeight={0}
					padding={1}
					scrollY
					viewportCulling
				>
					<box flexDirection="column" width="100%" gap={1}>
						<text fg={theme.accent}>{chapter.title}</text>
						<Narration text={chapter.summary} fg={theme.dim} />
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
							onSelect={onSelectFile}
							onToggleReview={onToggleFileReview}
						/>
					</box>
				</scrollbox>
			) : (
				<box flexGrow={1} flexShrink={1} minHeight={0} />
			)}
		</box>
	);
}

// ── Prologue ────────────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
	return (
		<text flexShrink={0} fg={theme.base} bg={color}>
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
	return (
		<box flexDirection="column" width="100%">
			<text fg={theme.mauve} attributes={createTextAttributes({ bold: true })}>
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
							fg={isChapterReviewed(vs, page.chapter.id) ? theme.green : theme.dim}
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
}: {
	prologue: Prologue;
	pages: Page[];
	vs: ViewState;
	onSelectPage: (index: number) => void;
}) {
	return (
		<box flexDirection="column" width="100%" gap={1}>
			{prologue.motivation ? <Narration text={prologue.motivation} fg={theme.text} /> : null}
			{prologue.outcome ? (
				<Hanging marker="→ " markerColor={theme.green}>
					<Narration text={prologue.outcome} fg={theme.green} />
				</Hanging>
			) : null}
			<box flexDirection="row" width="100%">
				<Badge
					label={`complexity ${prologue.complexity.level}`}
					color={complexityColor[prologue.complexity.level] ?? theme.surface}
				/>
				<box flexGrow={1} minWidth={0} paddingLeft={1}>
					<Narration text={prologue.complexity.reasoning} fg={theme.dim} />
				</box>
			</box>

			{prologue.keyChanges.length ? (
				<PrologueSection title="What changed">
					{prologue.keyChanges.map((kc) => (
						<Hanging key={kc.summary} marker="• " markerColor={theme.accent}>
							<Narration text={kc.summary} fg={theme.text} />
							<Narration text={kc.description} fg={theme.dim} />
						</Hanging>
					))}
				</PrologueSection>
			) : null}

			{prologue.focusAreas.length ? (
				<PrologueSection title="Worth a look">
					{prologue.focusAreas.map((fa) => (
						<box key={fa.title} flexDirection="column" width="100%">
							<box flexDirection="row" width="100%">
								<Badge
									label={fa.severity.toUpperCase()}
									color={severityColor[fa.severity] ?? theme.surface}
								/>
								<text flexShrink={0} fg={theme.dim}>
									{` ${fa.type} `}
								</text>
								<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text}>
									{fa.title}
								</text>
							</box>
							<box paddingLeft={2} width="100%">
								<Narration text={fa.description} fg={theme.dim} />
							</box>
						</box>
					))}
				</PrologueSection>
			) : null}

			{prologue.diagram ? (
				<box flexDirection="column" border borderColor={theme.surface} title=" diagram (mermaid) ">
					<text fg={theme.dim}>{prologue.diagram}</text>
				</box>
			) : null}

			<PrologueSection title="Chapters" gap={0}>
				<PrologueChapters pages={pages} vs={vs} onSelectPage={onSelectPage} />
			</PrologueSection>
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
				return (
					<box key={path} flexDirection="row" width="100%" height={1}>
						<text flexShrink={0} fg={active ? theme.accent : theme.surface}>
							{active ? "▸" : " "}
						</text>
						<text
							flexShrink={0}
							fg={done ? theme.green : theme.dim}
							onMouseDown={() => onToggleReview(path)}
						>
							{`[${done ? "x" : " "}] `}
						</text>
						<text
							flexGrow={1}
							flexShrink={1}
							minWidth={0}
							fg={active ? theme.accent : done ? theme.green : theme.dim}
							wrapMode="none"
							truncate
							onMouseDown={() => onSelect(index)}
						>
							{path}
						</text>
						{stat ? (
							<text flexShrink={0} paddingLeft={1}>
								<span fg={theme.green}>+{stat.additions}</span>
								<span> </span>
								<span fg={theme.red}>-{stat.deletions}</span>
							</text>
						) : null}
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
					<box id={keyChangeId(chapter.id, i)} key={kc.content} flexDirection="row" width="100%">
						<text flexShrink={0} fg={active ? theme.accent : theme.surface}>
							{active ? "▸" : " "}
						</text>
						<text
							flexShrink={0}
							fg={checked ? theme.green : theme.dim}
							onMouseDown={(event) => {
								event.stopPropagation();
								onToggle(i);
							}}
						>
							{`[${checked ? "x" : " "}] `}
						</text>
						<box flexGrow={1} minWidth={0} onMouseDown={() => onFocus(i)}>
							<Narration
								text={`${i + 1}. ${kc.content}`}
								fg={active ? theme.accent : checked ? theme.green : theme.text}
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
	return (
		<box flexDirection="column">
			<text fg={message.author.kind === THREAD_AUTHOR_KIND.AGENT ? theme.mauve : theme.accent}>
				{message.author.kind === THREAD_AUTHOR_KIND.AGENT ? "Agent" : "Human"} ·{" "}
				{message.author.name}
			</text>
			<text fg={dealtWith ? theme.dim : theme.text}>{message.body}</text>
			{canDelete ? (
				<text
					fg={theme.red}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onDelete(message.id);
					}}
				>
					[Delete message]
				</text>
			) : null}
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
	const dealtWith = thread.status === THREAD_STATUS.DEALT_WITH;
	return (
		<box
			flexDirection="column"
			border={["left"]}
			borderColor={dealtWith ? theme.green : theme.yellow}
			paddingLeft={1}
			marginLeft={2}
		>
			<text fg={dealtWith ? theme.green : theme.yellow}>
				{dealtWith ? "✓ Dealt with" : "! Open"} · Thread {thread.id}
			</text>
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
					[{dealtWith ? "Reopen" : "Mark dealt with"}]
				</text>
				<text> </text>
				<text
					fg={theme.red}
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

const THREAD_COMPOSER_ID = "inline-thread-composer";

function ThreadComposer({
	title,
	range,
	body,
	notice,
	textareaRef,
	onContentChange,
	onSave,
	onCancel,
}: {
	title: string;
	range: DiffLineRange;
	body: string;
	notice: string | null;
	textareaRef: RefObject<TextareaRenderable | null>;
	onContentChange: () => void;
	onSave: () => void;
	onCancel: () => void;
}) {
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
			<text fg={theme.text}>
				{range.filePath} · {range.side} ·{" "}
				{range.startLine === range.endLine
					? `line ${range.startLine}`
					: `lines ${range.startLine}-${range.endLine}`}{" "}
				· review unit oldStart {range.hunkOldStart}
			</text>
			<textarea
				ref={textareaRef}
				initialValue={body}
				focused
				height={4}
				placeholder="Write feedback…"
				backgroundColor={theme.base}
				focusedBackgroundColor={theme.base}
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
					}
				}}
			/>
			{notice ? <text fg={theme.red}>{notice}</text> : null}
			<box flexDirection="row">
				<text fg={theme.green} onMouseDown={onSave}>
					[Save Ctrl+Enter]
				</text>
				<text> </text>
				<text fg={theme.dim} onMouseDown={onCancel}>
					[Cancel Escape]
				</text>
			</box>
		</box>
	);
}

const fileHeaderId = (chapterId: string, index: number) =>
	`chapter-file-header:${chapterId}:${index}`;

/**
 * Side-by-side only earns its half of the terminal when both sides have
 * changed lines; a new or deleted file would otherwise face a blank pane.
 */
const layoutForFile = (file: ChapterDiffFile, width: number): DiffLayout => {
	if (width < MIN_SPLIT_DIFF_WIDTH) return "stack";
	const changes = file.metadata.hunks.flatMap((hunk) => hunk.hunkContent);
	const deletions = changes.reduce(
		(total, change) => total + (change.type === "context" ? 0 : change.deletions),
		0,
	);
	const additions = changes.reduce(
		(total, change) => total + (change.type === "context" ? 0 : change.additions),
		0,
	);
	return deletions > 0 && additions > 0 ? "split" : "stack";
};

function ChapterView({
	chapter,
	diffFiles,
	width,
	vs,
	selectedFile,
	selectedHunkIndex,
	selectedKeyChange,
	collapsedFiles,
	threads,
	selectedThreadRange,
	threadDraft,
	replyDraft,
	onSelectFile,
	onToggleCollapse,
	onToggleFileReview,
	onSelectThreadRange,
	onReplyThread,
	onDeleteThread,
	onDeleteThreadMessage,
	onToggleThreadStatus,
}: {
	chapter: Chapter;
	diffFiles: DiffFile[] | null;
	width: number;
	vs: ViewState;
	selectedFile: number;
	selectedHunkIndex: number;
	selectedKeyChange: number;
	collapsedFiles: Set<string>;
	threads: ReviewThread[];
	selectedThreadRange: DiffLineRange | undefined;
	threadDraft: DiffInlineAttachment | undefined;
	replyDraft: { threadId: string; content: ReactNode } | undefined;
	onSelectFile: (index: number) => void;
	onToggleCollapse: (path: string) => void;
	onToggleFileReview: (path: string) => void;
	onSelectThreadRange: (range: DiffLineRange) => void;
	onReplyThread: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteThreadMessage: (threadId: string, messageId: string) => void;
	onToggleThreadStatus: (thread: ReviewThread) => void;
}) {
	const chapterDiffFiles = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];
	const paths = chapterFilePaths(chapter);
	const focusedDecorationId = `key-change:${chapter.id}:${selectedKeyChange}`;
	const decorations: RangeDecoration[] = (
		chapter.keyChanges[selectedKeyChange]?.lineRefs ?? []
	).map((ref, refIndex) => ({
		...ref,
		id: `${focusedDecorationId}:${refIndex}`,
		focusId: focusedDecorationId,
	}));
	const chapterThreads = threads.filter((thread) =>
		chapter.hunkRefs.some(
			(reference) =>
				reference.filePath === thread.anchor.filePath &&
				reference.oldStart === thread.anchor.oldStart,
		),
	);
	const inlineAttachments: DiffInlineAttachment[] = [
		...chapterThreads.map((thread) => ({
			id: thread.id,
			anchor: {
				filePath: thread.anchor.filePath,
				hunkOldStart: thread.anchor.oldStart,
				side: thread.anchor.side,
				startLine: thread.anchor.startLine,
				endLine: thread.anchor.endLine,
			},
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
									<text flexShrink={0} fg={focused ? theme.accent : theme.surface}>
										{focused ? "▸" : " "}
									</text>
									<text
										flexShrink={0}
										fg={reviewed ? theme.green : theme.dim}
										onMouseDown={() => onToggleFileReview(path)}
									>
										[{reviewed ? "x" : " "}]
									</text>
									<text
										flexShrink={0}
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
										layout={layoutForFile(diffFile, width)}
										width={width}
										showLineNumbers
										selectedHunkIndex={focused ? selectedHunkIndex : -1}
										decorations={decorations}
										focusedDecorationId={focusedDecorationId}
										selectedRange={selectedThreadRange}
										inlineAttachments={inlineAttachments}
										onRangeSelect={onSelectThreadRange}
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
const keyedSemanticLines = (lines: SemanticDiffResult["files"][number]["lines"]) => {
	const occurrences = new Map<string, number>();
	return lines.map((line) => {
		const occurrence = occurrences.get(line.text) ?? 0;
		occurrences.set(line.text, occurrence + 1);
		return { key: `${line.text}:${occurrence}`, line };
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
				Read-only semantic view · key-change anchors, exact range highlights, and threads are
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
							<text flexShrink={0} fg={focused ? theme.accent : theme.surface}>
								{focused ? "▸" : " "}
							</text>
							<text
								flexShrink={0}
								fg={reviewed ? theme.green : theme.dim}
								onMouseDown={() => onToggleFileReview(file.path)}
							>
								[{reviewed ? "x" : " "}]
							</text>
							<text
								flexShrink={1}
								minWidth={0}
								wrapMode="none"
								truncate
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
										wrapMode="none"
										onMouseDown={() => onSelectFile(fileIndex)}
									>
										{line.spans.length
											? line.spans.map((span, spanIndex) => (
													<span
														// biome-ignore lint/suspicious/noArrayIndexKey: immutable output spans have no independent identity.
														key={`${spanIndex}:${span.text}`}
														fg={span.fg}
														attributes={createTextAttributes(span)}
													>
														{span.text}
													</span>
												))
											: " "}
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
			<text fg={theme.text}> ]c/[c next/previous page (prologue is page one)</text>
			<text fg={theme.text}> a next unreviewed chapter</text>
			<text fg={theme.text}> pointer: click any page in the sidebar index</text>
			<text fg={theme.mauve}>Files</text>
			<text fg={theme.text}> tab/shift-tab focus · enter toggle diff</text>
			<text fg={theme.text}> c/e collapse/expand all</text>
			<text fg={theme.mauve}>Review</text>
			<text fg={theme.text}> x chapter · f focused file</text>
			<text fg={theme.text}> {"{/}"} focus key change · r toggle · 1–9 direct</text>
			<text fg={theme.text}> pointer: click/drag line-number gutter to start a thread</text>
			<text fg={theme.mauve}>Views</text>
			<text fg={theme.text}> F10 → View toggles Patch / read-only Semantic</text>
			<text fg={theme.dim}> anchors, exact range highlights, and threads are Patch-only</text>
			<text fg={theme.mauve}>Menu/help/quit</text>
			<text fg={theme.text}> F10 menu · ? close · q/esc quit</text>
		</box>
	);
}

// ── App shell ───────────────────────────────────────────────────────────────
type ThreadDraft =
	| { kind: "thread"; range: DiffLineRange }
	| { kind: "reply"; threadId: string; range: DiffLineRange };

const defaultHumanAuthor: ThreadAuthor = {
	kind: THREAD_AUTHOR_KIND.HUMAN,
	name: "Reviewer",
};

const diffRangeForThread = (thread: ReviewThread): DiffLineRange => ({
	filePath: thread.anchor.filePath,
	hunkOldStart: thread.anchor.oldStart,
	side: thread.anchor.side,
	startLine: thread.anchor.startLine,
	endLine: thread.anchor.endLine,
});

export function App({
	file,
	diffFiles = null,
	loadSemanticDiff,
	initialViewState = emptyViewState(),
	initialThreads = [],
	threadActions,
	humanAuthor = defaultHumanAuthor,
	onViewStateChange,
	onQuit,
}: {
	file: RevueChaptersFile;
	diffFiles?: DiffFile[] | null;
	loadSemanticDiff?: (width: number) => Promise<SemanticDiffResult>;
	initialViewState?: ViewState;
	initialThreads?: ReviewThread[];
	threadActions?: ThreadActions;
	humanAuthor?: ThreadAuthor;
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
	const [indexExpanded, setIndexExpanded] = useState(true);
	const [viewMode, setViewMode] = useState<"patch" | "semantic">("patch");
	const [semantic, setSemantic] = useState<SemanticDiffResult | null>(null);
	const [semanticLoading, setSemanticLoading] = useState(false);
	const [semanticNotice, setSemanticNotice] = useState<string | null>(null);
	const [vs, setVs] = useState(initialViewState);
	const [threads, setThreads] = useState(() => sortThreads(initialThreads));
	const [threadDraft, setThreadDraft] = useState<ThreadDraft | null>(null);
	const [threadBody, setThreadBody] = useState("");
	const [threadNotice, setThreadNotice] = useState<string | null>(null);
	const textareaRef = useRef<TextareaRenderable>(null);
	const pageScroll = useRef<ScrollBoxRenderable>(null);
	const pendingViewProgress = useRef<{ mode: "patch" | "semantic"; progress: number } | null>(null);
	const panelScroll = useRef<ScrollBoxRenderable>(null);
	const indexScroll = useRef<ScrollBoxRenderable>(null);
	const resizingPanel = useRef(false);
	const chapterNavigationPrefix = useRef<"[" | "]" | null>(null);
	const { width } = useTerminalDimensions();
	const [requestedPanelWidth, setRequestedPanelWidth] = useState(() => defaultPanelWidth(width));
	const panelWidth = resolvePanelWidth(width, requestedPanelWidth);
	const showChapterPanel = width >= MIN_CHAPTER_PANEL_TERMINAL_WIDTH;
	const contentWidth = Math.max(MIN_CONTENT_WIDTH, width - (showChapterPanel ? panelWidth : 0) - 4);
	const page = pages[current];
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();

	useEffect(() => {
		const scroll = pageScroll.current;
		const pending = pendingViewProgress.current;
		if (!scroll || pending?.mode !== viewMode) return;
		const maximum = Math.max(0, scroll.scrollHeight - scroll.viewport.height);
		scroll.scrollTo(Math.round(maximum * pending.progress));
		pendingViewProgress.current = null;
	}, [viewMode]);

	useEffect(() => {
		if (!indexExpanded) return;
		const revealCurrentPage = () => indexScroll.current?.scrollChildIntoView(pageRowId(current));
		revealCurrentPage();
		const retry = setTimeout(revealCurrentPage, 50);
		return () => clearTimeout(retry);
	}, [current, indexExpanded]);

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

	useEffect(() => {
		if (!threadDraft) return;
		const revealThreadComposer = () => pageScroll.current?.scrollChildIntoView(THREAD_COMPOSER_ID);
		revealThreadComposer();
		const retry = setTimeout(revealThreadComposer, 50);
		return () => clearTimeout(retry);
	}, [threadDraft]);

	function selectThreadRange(range: DiffLineRange) {
		setThreadDraft({ kind: "thread", range });
		setThreadBody("");
		setThreadNotice(null);
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
				const range = threadDraft.range;
				const anchor: ThreadAnchor = {
					filePath: range.filePath,
					oldStart: range.hunkOldStart,
					side: range.side,
					startLine: range.startLine,
					endLine: range.endLine,
				};
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
	function goto(index: number) {
		const next = Math.max(0, Math.min(index, pages.length - 1));
		if (next === current) return;
		pageScroll.current?.scrollTo(0);
		pendingViewProgress.current = null;
		setCurrent(next);
		setSelectedFile(0);
		setSelectedHunkIndex(0);
		setSelectedKeyChange(0);
		setCollapsedFiles(new Set());
		setFileFocusRequest(0);
		setKeyFocusRequest(0);
		setDiffAnchorTarget(null);
		cancelThreadDraft();
	}
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
		movePage(prefix === "]" ? 1 : -1);
		return true;
	}
	function toggleShortcutHelp() {
		pageScroll.current?.scrollTo(0);
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
		setViewMode(next);
	}
	function showPatch() {
		changeViewMode("patch");
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
		setSemanticNotice("Loading read-only semantic diff from pinned run snapshots...");
		try {
			const result = await loadSemanticDiff(contentWidth);
			setSemantic(result);
			setSemanticNotice(null);
			changeViewMode("semantic");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			setSemanticNotice(terminalSafe(detail));
			setViewMode("patch");
		} finally {
			setSemanticLoading(false);
		}
	}

	const menus = buildAppMenus({
		canMovePrevious: current > 0,
		canMoveNext: current < pages.length - 1,
		canChangeFiles: Boolean(chapter),
		canMoveNextUnreviewed:
			Boolean(chapter) && chapters.some((candidate) => !isChapterReviewed(vs, candidate.id)),
		showHelp,
		viewMode,
		semanticLoading,
		requestQuit: () => onQuit?.(),
		movePrevious: () => movePage(-1),
		moveNext: () => movePage(1),
		moveNextUnreviewed,
		collapseFiles,
		expandFiles,
		toggleHelp: toggleShortcutHelp,
		showPatch,
		showSemantic: () => void showSemantic(),
	});
	const menu = useMenuController(menus);
	const threadComposer = threadDraft ? (
		<ThreadComposer
			key={threadDraft.kind === "thread" ? "new-thread" : threadDraft.threadId}
			title={threadDraft.kind === "thread" ? "New review thread" : "Reply to thread"}
			range={threadDraft.range}
			body={threadBody}
			notice={threadNotice}
			textareaRef={textareaRef}
			onContentChange={() => setThreadBody(textareaRef.current?.editBuffer.getText() ?? "")}
			onSave={saveThreadDraft}
			onCancel={cancelThreadDraft}
		/>
	) : undefined;
	const newThreadDraft: DiffInlineAttachment | undefined =
		threadDraft?.kind === "thread" && threadComposer
			? {
					id: THREAD_COMPOSER_ID,
					anchor: threadDraft.range,
					content: threadComposer,
				}
			: undefined;
	const replyDraft =
		threadDraft?.kind === "reply" && threadComposer
			? { threadId: threadDraft.threadId, content: threadComposer }
			: undefined;

	useKeyboard((key) => {
		const name = key.name;
		const paths = chapter ? chapterFilePaths(chapter) : [];

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
						chapterCount={chapters.length}
						width={panelWidth}
						vs={vs}
						indexExpanded={indexExpanded}
						selectedFile={selectedFile}
						selectedKeyChange={selectedKeyChange}
						stats={stats}
						reviewed={reviewed}
						onNavigatePage={goto}
						onToggleIndex={() => setIndexExpanded((expanded) => !expanded)}
						onResizeStart={startPanelResize}
						onSelectFile={selectFile}
						onFocusKeyChange={focusKeyChange}
						indexScrollRef={indexScroll}
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
							{page?.kind === "prologue" ? (
								<PrologueView prologue={page.prologue} pages={pages} vs={vs} onSelectPage={goto} />
							) : null}
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
									threads={threads}
									selectedThreadRange={
										threadDraft?.kind === "thread" ? threadDraft.range : undefined
									}
									threadDraft={newThreadDraft}
									replyDraft={replyDraft}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
									onSelectThreadRange={selectThreadRange}
									onReplyThread={startThreadReply}
									onDeleteThread={deleteInlineThread}
									onDeleteThreadMessage={deleteInlineThreadMessage}
									onToggleThreadStatus={toggleInlineThreadStatus}
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
			{!threadDraft && threadNotice ? <text fg={theme.red}>{threadNotice}</text> : null}
			<box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="column">
				<text fg={theme.dim}>
					{`${current + 1}/${pages.length} · j/k scroll · d/u half-page · space/b page · g/G top/bottom`}
				</text>
				<text fg={theme.dim}>
					{viewMode === "semantic"
						? "Semantic is read-only · anchors/ranges/threads Patch-only · F10 View to switch"
						: "click/drag gutter thread · F10 menu · ]c/[c page · tab file · f/x review · ? help · q quit"}
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
		initialThreads?: ReviewThread[];
		threadActions?: ThreadActions;
		humanAuthor?: ThreadAuthor;
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
				initialThreads={options.initialThreads}
				threadActions={options.threadActions}
				humanAuthor={options.humanAuthor}
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
