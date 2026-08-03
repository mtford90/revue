// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
import {
	createCliRenderer,
	createTextAttributes,
	type MouseEvent as OpenTUIMouseEvent,
	type ScrollBoxRenderable,
	type TextareaRenderable,
} from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
	DiffBody,
	type DiffFile,
	DiffFileHeader,
	type DiffInlineAttachment,
	type DiffLineRange,
	type DiffSide,
	decorationAnchorId,
	diffRangeWithin,
	findFocusedDecorationAnchor,
	parsePatch,
	prepareSyntaxHighlighting,
	type RangeDecoration,
	type SpanEmphasis,
} from "@revue/diff-renderer";
import {
	type Appearance,
	resolveTheme,
	THEMES,
	type Theme,
	withTransparentSurfaces,
} from "@revue/theme";
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
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { copyToClipboard } from "./clipboard.ts";
import { type FileStat, selectChapterFiles, statsByPath } from "./diff.ts";
import {
	type DiffLayoutPreference,
	defaultPanelWidth,
	layoutForFile,
	resolveLayout,
	resolvePanelWidth,
	type SidebarPreference,
} from "./layout.ts";
import { Narration } from "./markdown.tsx";
import {
	buildAppMenus,
	ContextMenu,
	MenuBackdrop,
	MenuBar,
	MenuDropdown,
	type MenuEntry,
	nextMenuItemIndex,
	selectable,
	useMenuController,
} from "./menu.tsx";
import type { FileDisplayPreference, Preferences } from "./preferences.ts";
import { type SemanticDiffResult, type SemanticEmphasis, terminalSafe } from "./semantic.ts";
import {
	formatSourceLocation,
	type PermalinkContext,
	permalinkBlocker,
	permalinkFor,
	sourceRangeFor,
} from "./sourceLink.ts";
import { complexityColor, severityColor, ThemeProvider, useTheme } from "./theme.ts";
import { ThemePicker, ThemePickerBackdrop } from "./themePicker.tsx";
import { addThreadReply, createThread, createThreadMessage, sortThreads } from "./threads.ts";
import {
	chapterFilePaths,
	isChapterReviewed,
	isFileReviewed,
	isKeyChangeChecked,
	nextUnreviewedChapter,
	type ReviewSessionState,
	reviewedChapterCount,
	toggleChapter,
	toggleFile,
	toggleKeyChange,
} from "./viewState.ts";

const PANEL_INDEX_MAX_ROWS = 8;
const COMPACT_NAV_WIDTH = 34;
const COMPACT_STRIP_WIDTH = 60;
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
	"s",
	"t",
	"y",
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

const pageId = (page: Page | undefined) =>
	page?.kind === "chapter" ? page.chapter.id : "prologue";

const emptyReviewPageState = () => ({
	selectedFile: 0,
	selectedHunk: 0,
	selectedKeyChange: 0,
	collapsedFiles: [] as string[],
	scrollTop: 0,
	panelScrollTop: 0,
});

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
		const label = page.kind === "chapter" ? `${page.chapter.order}. ${page.label}` : page.label;
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
					{page.kind === "chapter" ? `[${done ? "x" : " "}] ` : "    "}
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
	reviewed,
	width,
	vs,
	onNavigatePage,
	onToggleChapterReview,
}: {
	page: Page | undefined;
	pages: Page[];
	current: number;
	chapterCount: number;
	reviewed: number;
	width: number;
	vs: ViewState;
	onNavigatePage: (index: number) => void;
	onToggleChapterReview: () => void;
}) {
	const theme = useTheme();
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const chapterReviewed = chapter ? isChapterReviewed(vs, chapter.id) : false;
	const compact = width < COMPACT_STRIP_WIDTH;
	return (
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
			<text flexShrink={0} fg={theme.muted}>
				{`${reviewed}/${chapterCount}${compact ? "" : " reviewed"} `}
			</text>
			<NavButton
				label={compact ? "▶" : "Next ▶"}
				enabled={current < pages.length - 1}
				onPress={() => onNavigatePage(current + 1)}
			/>
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
	onSelectFile,
	onFocusKeyChange,
	onToggleFileReview,
	onToggleKeyChange,
}: {
	chapter: Chapter;
	vs: ViewState;
	selectedFile: number;
	selectedKeyChange: number;
	stats: Map<string, FileStat>;
	onSelectFile: (index: number) => void;
	onFocusKeyChange: (index: number) => void;
	onToggleFileReview: (path: string) => void;
	onToggleKeyChange: (index: number) => void;
}) {
	const theme = useTheme();
	return (
		<box flexDirection="column" width="100%" gap={1}>
			<text fg={theme.accent}>{chapter.title}</text>
			<Narration text={chapter.summary} fg={theme.muted} />
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
	const theme = useTheme();
	const chapter = page?.kind === "chapter" ? page.chapter : null;
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
				<box flexGrow={1} minWidth={0} />
				<text flexShrink={0} fg={theme.muted}>
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
				<text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.heading}>
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
					<ChapterBrief
						chapter={chapter}
						vs={vs}
						selectedFile={selectedFile}
						selectedKeyChange={selectedKeyChange}
						stats={stats}
						onSelectFile={onSelectFile}
						onFocusKeyChange={onFocusKeyChange}
						onToggleFileReview={onToggleFileReview}
						onToggleKeyChange={onToggleKeyChange}
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
}: {
	prologue: Prologue;
	pages: Page[];
	vs: ViewState;
	onSelectPage: (index: number) => void;
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
						<box key={fa.title} flexDirection="column" width="100%">
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
	const theme = useTheme();
	const paths = chapterFilePaths(chapter);
	return (
		<box flexDirection="column">
			<text fg={theme.heading}>Files ({paths.length})</text>
			{paths.map((path, index) => {
				const done = isFileReviewed(vs, chapter.id, path);
				const active = index === selected;
				const stat = stats.get(path);
				return (
					<box key={path} flexDirection="row" width="100%" height={1}>
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
							onMouseDown={() => onSelect(index)}
						>
							{path}
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
								text={`${i + 1}. ${kc.content}`}
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
	return (
		<box flexDirection="column">
			<text fg={message.author.kind === THREAD_AUTHOR_KIND.AGENT ? theme.heading : theme.accent}>
				{message.author.kind === THREAD_AUTHOR_KIND.AGENT ? "Agent" : "Human"} ·{" "}
				{message.author.name}
			</text>
			<text fg={dealtWith ? theme.muted : theme.text}>{message.body}</text>
			{canDelete ? (
				<text
					fg={theme.badgeRemoved}
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
	const theme = useTheme();
	const dealtWith = thread.status === THREAD_STATUS.DEALT_WITH;
	return (
		<box
			flexDirection="column"
			border
			borderColor={dealtWith ? theme.badgeAdded : theme.badgeModified}
			backgroundColor={theme.panel}
			paddingLeft={1}
			paddingRight={1}
			marginLeft={2}
			marginRight={1}
		>
			<text fg={dealtWith ? theme.badgeAdded : theme.badgeModified}>
				{dealtWith ? "✓ Resolved" : "! Open"} · Thread {thread.id}
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
					[{dealtWith ? "Reopen" : "Resolve"}]
				</text>
				<text> </text>
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

const THREAD_COMPOSER_ID = "inline-thread-composer";
const COPY_NOTICE_MS = 2_500;

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

const fileHeaderId = (chapterId: string, index: number) =>
	`chapter-file-header:${chapterId}:${index}`;

function ChapterView({
	chapter,
	diffTheme,
	diffFiles,
	width,
	diffPreference,
	fileDisplay,
	splitFits,
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
	onRangeContextMenu,
	onReplyThread,
	onDeleteThread,
	onDeleteThreadMessage,
	onToggleThreadStatus,
}: {
	chapter: Chapter;
	diffTheme: Theme;
	diffFiles: DiffFile[] | null;
	width: number;
	diffPreference: DiffLayoutPreference;
	fileDisplay: FileDisplayPreference;
	splitFits: boolean;
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
	onRangeContextMenu: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onReplyThread: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteThreadMessage: (threadId: string, messageId: string) => void;
	onToggleThreadStatus: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const chapterDiffFiles = diffFiles ? selectChapterFiles(chapter, diffFiles) : [];
	const paths = chapterFilePaths(chapter);
	const visibleDiffFiles =
		fileDisplay === "focused"
			? chapterDiffFiles.filter((file) => file.chapterPath === paths[selectedFile])
			: chapterDiffFiles;
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
			{visibleDiffFiles.length ? (
				<box flexDirection="column" width="100%">
					{visibleDiffFiles.map((diffFile, streamIndex) => {
						const path = diffFile.chapterPath;
						const fileIndex = paths.indexOf(path);
						const focused = fileIndex === selectedFile;
						const collapsed = collapsedFiles.has(path);
						const reviewed = isFileReviewed(vs, chapter.id, path);
						return (
							<box key={diffFile.id} flexDirection="column" width="100%">
								{streamIndex > 0 ? (
									<text fg={theme.border}>{"─".repeat(Math.max(1, width - 2))}</text>
								) : null}
								<box
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
											onSelect={() => onSelectFile(fileIndex)}
										/>
									</box>
								</box>
								{collapsed ? null : (
									<DiffBody
										file={diffFile}
										theme={diffTheme}
										layout={layoutForFile({
											file: diffFile,
											preference: diffPreference,
											splitFits,
										})}
										width={width}
										showLineNumbers
										selectedHunkIndex={focused ? selectedHunkIndex : -1}
										decorations={decorations}
										focusedDecorationId={focusedDecorationId}
										selectedRange={selectedThreadRange}
										inlineAttachments={inlineAttachments}
										onRangeSelect={onSelectThreadRange}
										onRangeContextMenu={onRangeContextMenu}
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
	width,
	diffPreference,
	fileDisplay,
	splitFits,
	vs,
	selectedFile,
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
	width: number;
	diffPreference: DiffLayoutPreference;
	fileDisplay: FileDisplayPreference;
	splitFits: boolean;
	vs: ViewState;
	selectedFile: number;
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
	onRangeContextMenu: (range: DiffLineRange, position: { x: number; y: number }) => void;
	onReplyThread: (thread: ReviewThread) => void;
	onDeleteThread: (id: string) => void;
	onDeleteThreadMessage: (threadId: string, messageId: string) => void;
	onToggleThreadStatus: (thread: ReviewThread) => void;
}) {
	const theme = useTheme();
	const paths = chapterFilePaths(chapter);
	const visiblePaths =
		fileDisplay === "focused" ? paths.slice(selectedFile, selectedFile + 1) : paths;
	const files = visiblePaths.flatMap((path) => {
		const file = semantic.files.find((candidate) => candidate.path === path);
		return file ? [file] : [];
	});
	const focusedDecorationId = `key-change:${chapter.id}:${selectedKeyChange}`;
	const decorations: RangeDecoration[] = (
		chapter.keyChanges[selectedKeyChange]?.lineRefs ?? []
	).map((ref, refIndex) => ({
		...ref,
		id: `${focusedDecorationId}:${refIndex}`,
		focusId: focusedDecorationId,
	}));
	const chapterThreads = threads.filter((thread) => paths.includes(thread.anchor.filePath));
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
			<text fg={theme.muted}>{semantic.version} · semantic view</text>
			{files.map((semanticFile, streamIndex) => {
				const fileIndex = paths.indexOf(semanticFile.path);
				const focused = fileIndex === selectedFile;
				const collapsed = collapsedFiles.has(semanticFile.path);
				const reviewed = isFileReviewed(vs, chapter.id, semanticFile.path);
				const emphasis: SpanEmphasis = {
					rangesFor: (side, line) =>
						(side === "deletions"
							? semanticFile.emphasis.deletions
							: semanticFile.emphasis.additions
						).get(line),
					deletionsFg: theme.badgeRemoved,
					additionsFg: theme.badgeAdded,
				};
				return (
					<box key={semanticFile.path} flexDirection="column" width="100%">
						{streamIndex > 0 ? (
							<text fg={theme.border}>{"─".repeat(Math.max(1, width - 2))}</text>
						) : null}
						<box
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
								onMouseDown={() => onToggleFileReview(semanticFile.path)}
							>
								[{reviewed ? "x" : " "}]
							</text>
							<text
								flexShrink={0}
								fg={focused ? theme.accent : theme.muted}
								onMouseDown={() => onToggleCollapse(semanticFile.path)}
							>
								{collapsed ? "▶" : "▼"}
							</text>
							{semanticFile.file ? (
								<box flexGrow={1} minWidth={0}>
									<DiffFileHeader
										file={semanticFile.file}
										theme={diffTheme}
										width={Math.max(1, width - 7)}
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
									{semanticFile.path}
								</text>
							)}
						</box>
						{collapsed ? null : (
							<box flexDirection="column" width="100%">
								{semanticFile.notes.map((note) => (
									<text key={note} fg={theme.muted} wrapMode="none" truncate>
										{note}
									</text>
								))}
								{semanticFile.file ? (
									<DiffBody
										file={semanticFile.file}
										theme={diffTheme}
										layout={layoutForFile({
											file: semanticFile.file,
											preference: diffPreference,
											splitFits,
										})}
										width={width}
										showLineNumbers
										showHunkHeaders={false}
										selectedHunkIndex={-1}
										decorations={decorations}
										focusedDecorationId={focusedDecorationId}
										selectedRange={selectedThreadRange}
										inlineAttachments={inlineAttachments}
										emphasis={emphasis}
										resolveRange={gitRangeResolver(diffFiles, semanticFile.path)}
										onRangeSelect={onSelectThreadRange}
										onRangeContextMenu={onRangeContextMenu}
									/>
								) : null}
							</box>
						)}
					</box>
				);
			})}
		</box>
	);
}

// ── Keyboard help ──────────────────────────────────────────────────────────
const SHORTCUT_SECTIONS: { title: string; lines: string[] }[] = [
	{
		title: "Scrolling",
		lines: [
			"j/k or ↑/↓ line",
			"d/u or ctrl-d/ctrl-u half-page",
			"space/ctrl-f page down · b/ctrl-b page up",
			"g/gg top · G bottom · PgUp/PgDn · wheel",
		],
	},
	{
		title: "Navigation",
		lines: [
			"]c/[c next/previous page (prologue is page one)",
			"a next unreviewed chapter",
			"pointer: the strip under the menu bar, or the sidebar index",
		],
	},
	{
		title: "Files",
		lines: ["tab/shift-tab focus · enter toggle diff", "c/e collapse/expand all"],
	},
	{
		title: "Review",
		lines: [
			"x chapter · f focused file",
			"{/} focus key change · r toggle · 1–9 direct",
			"pointer: click/drag line-number gutter to start a thread",
		],
	},
	{
		title: "Copying",
		lines: [
			"drag over code to select it · y copies the selection",
			"right-click a line for copy text, copy path, copy link, comment",
			"ctrl-y path:line · ctrl-g GitHub link, while a thread is open",
			"links need a GitHub remote and a committed side",
		],
	},
	{
		title: "Views",
		lines: [
			"s show/hide the sidebar; its narrative stacks above the diff",
			"F10 → View toggles Patch / read-only Semantic",
			"F10 → View sets diff layout: auto, split or stacked",
			"anchors, exact range highlights, and threads are Patch-only",
		],
	},
	{
		title: "Menus",
		lines: ["t theme picker", "F10 · File, Navigate, View, Help", "? shortcuts · q/esc quit"],
	},
];

const SHORTCUT_ROWS = SHORTCUT_SECTIONS.reduce(
	(total, section) => total + section.lines.length + 1,
	0,
);
const HELP_MODAL_MAX_WIDTH = 66;

/** Floats over the review rather than displacing it, so the page stays in sight. */
function HelpModal({
	terminalWidth,
	terminalHeight,
	scrollRef,
	onClose,
}: {
	terminalWidth: number;
	terminalHeight: number;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	onClose: () => void;
}) {
	const theme = useTheme();
	const width = Math.max(20, Math.min(HELP_MODAL_MAX_WIDTH, terminalWidth - 4));
	const height = Math.max(5, Math.min(SHORTCUT_ROWS + 3, terminalHeight - 4));
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
					{SHORTCUT_SECTIONS.map((section) => (
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

// ── App shell ───────────────────────────────────────────────────────────────
type ThreadDraft =
	| { kind: "thread"; range: DiffLineRange }
	| { kind: "reply"; threadId: string; range: DiffLineRange };

type ContextMenuState = {
	range: DiffLineRange;
	position: { x: number; y: number };
	selected: number;
	/** Whatever was dragged over when the menu opened, so the entry survives the menu taking focus. */
	selectedText: string | null;
};

/** The verbs a selected range answers to, shared by the pointer menu and the composer footer. */
const buildRangeMenu = ({
	selectedText,
	linkBlocker,
	copyText,
	copyLocation,
	copyLink,
	comment,
}: {
	selectedText: string | null;
	linkBlocker: string | null;
	copyText: () => void;
	copyLocation: () => void;
	copyLink: () => void;
	comment: () => void;
}): MenuEntry[] => [
	...(selectedText
		? ([
				{ kind: "item", label: "Copy selected text", hint: "y", action: copyText },
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
	initialSessionState = { pages: {} },
	initialPreferences = {},
	initialTheme = resolveTheme(undefined),
	initialSyntaxTheme = initialTheme.syntaxTheme,
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
}: {
	file: RevueChaptersFile;
	diffFiles?: DiffFile[] | null;
	loadSemanticDiff?: () => Promise<SemanticDiffResult>;
	initialViewState?: ViewState;
	initialSessionState?: ReviewSessionState;
	initialPreferences?: Preferences;
	initialTheme?: Theme;
	/** The syntax theme the caller already prepared highlights for. */
	initialSyntaxTheme?: string;
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
}) {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [chosenTheme, setChosenTheme] = useState(initialTheme);
	const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);
	const [themePicker, setThemePicker] = useState<{ selected: number } | null>(null);
	const shownTheme = previewTheme ?? chosenTheme;
	const theme = transparentSurfaces ? withTransparentSurfaces(shownTheme) : shownTheme;
	const pages = useMemo(() => buildPages(file), [file]);
	const chapters = pages.flatMap((candidate) =>
		candidate.kind === "chapter" ? [candidate.chapter] : [],
	);
	const restoredPage = pages.findIndex(
		(candidate) => pageId(candidate) === initialSessionState.pageId,
	);
	const initialCurrent = restoredPage >= 0 ? restoredPage : 0;
	const initialPageState =
		initialSessionState.pages[pageId(pages[initialCurrent])] ?? emptyReviewPageState();
	const sessionRef = useRef(initialSessionState);
	const preferencesRef = useRef(initialPreferences);
	const [current, setCurrent] = useState(initialCurrent);
	const [selectedFile, setSelectedFile] = useState(initialPageState.selectedFile);
	const [selectedHunkIndex, setSelectedHunkIndex] = useState(initialPageState.selectedHunk);
	const [selectedKeyChange, setSelectedKeyChange] = useState(initialPageState.selectedKeyChange);
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
		() => new Set(initialPageState.collapsedFiles),
	);
	const [fileFocusRequest, setFileFocusRequest] = useState(0);
	const [keyFocusRequest, setKeyFocusRequest] = useState(0);
	const [diffAnchorTarget, setDiffAnchorTarget] = useState<{ id: string; request: number } | null>(
		null,
	);
	const [showHelp, setShowHelp] = useState(false);
	const [indexExpanded, setIndexExpandedState] = useState(initialPreferences.indexExpanded ?? true);
	const [sidebarPreference, setSidebarPreferenceState] = useState<SidebarPreference>(
		initialPreferences.sidebarPreference ?? "auto",
	);
	const [diffPreference, setDiffPreferenceState] = useState<DiffLayoutPreference>(
		initialPreferences.diffPreference ?? "auto",
	);
	const [fileDisplay, setFileDisplayState] = useState<FileDisplayPreference>(
		initialPreferences.fileDisplay ?? "all",
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
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	// The nonce re-arms the timeout when the same text is copied twice running.
	const [copyNotice, setCopyNotice] = useState<{ text: string; nonce: number } | null>(null);
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
	const page = pages[current];
	const chapter = page?.kind === "chapter" ? page.chapter : null;
	const stats = diffFiles ? statsByPath(diffFiles) : new Map<string, FileStat>();
	// Highlighting a file under a new syntax theme is asynchronous, so the diff keeps the last
	// prepared colours until the new ones exist rather than dropping back to unhighlighted text.
	const [preparedSyntaxTheme, setPreparedSyntaxTheme] = useState(initialSyntaxTheme);
	const diffTheme =
		preparedSyntaxTheme === theme.syntaxTheme
			? theme
			: { ...theme, syntaxTheme: preparedSyntaxTheme };

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
	function changeFileDisplay(next: FileDisplayPreference) {
		setFileDisplayState(next);
		updatePreferences({ fileDisplay: next });
		requestFileFocus();
	}
	function changePanelWidth(next: number) {
		setRequestedPanelWidthState(next);
		updatePreferences({ panelWidth: next });
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
		const highlightable = [...(diffFiles ?? []), ...semanticDiffFiles(semantic)];
		if (!highlightable.length || preparedSyntaxTheme === theme.syntaxTheme) return;
		let current = true;
		const syntaxTheme = theme.syntaxTheme;
		prepareSyntaxHighlighting(highlightable, syntaxTheme).then(() => {
			if (current) setPreparedSyntaxTheme(syntaxTheme);
		});
		return () => {
			current = false;
		};
	}, [diffFiles, semantic, preparedSyntaxTheme, theme.syntaxTheme]);

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
		const anchorFocusedFile = () =>
			pageScroll.current?.scrollChildIntoView(fileHeaderId(chapter.id, selectedFile));
		anchorFocusedFile();
		const retry = setTimeout(anchorFocusedFile, 50);
		return () => clearTimeout(retry);
	}, [chapter, selectedFile, fileFocusRequest]);

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
		const anchorFocusedDiffLine = () =>
			pageScroll.current?.scrollChildIntoView(diffAnchorTarget.id);
		anchorFocusedDiffLine();
		const retry = setTimeout(anchorFocusedDiffLine, 50);
		return () => clearTimeout(retry);
	}, [diffAnchorTarget]);

	useEffect(() => {
		if (!copyNotice) return;
		const clear = setTimeout(() => setCopyNotice(null), COPY_NOTICE_MS);
		return () => clearTimeout(clear);
	}, [copyNotice]);

	useEffect(() => {
		if (!threadDraft) return;
		const revealThreadComposer = () => pageScroll.current?.scrollChildIntoView(THREAD_COMPOSER_ID);
		revealThreadComposer();
		const retry = setTimeout(revealThreadComposer, 50);
		return () => clearTimeout(retry);
	}, [threadDraft]);

	function previousPathFor(filePath: string) {
		return diffFiles?.find((candidate) => candidate.path === filePath)?.previousPath;
	}
	function copy({ text, notice }: { text: string; notice: string }) {
		const copied = onCopy ? onCopy(text) : copyToClipboard(renderer, text);
		setCopyNotice((current) => ({
			text: copied ? notice : "Could not reach the clipboard",
			nonce: (current?.nonce ?? 0) + 1,
		}));
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
		copy({ text, notice: `Copied ${lines} selected ${lines === 1 ? "line" : "lines"}` });
	}
	function openRangeContextMenu(range: DiffLineRange, position: { x: number; y: number }) {
		setCopyNotice(null);
		setContextMenu({
			range: highlightedRange(range) ?? range,
			position,
			selected: 0,
			selectedText: highlightedText(),
		});
	}
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
		const nextPageId = pageId(pages[next]);
		saveCurrentSession(nextPageId);
		const restored = sessionRef.current.pages[nextPageId] ?? emptyReviewPageState();
		pageScroll.current?.scrollTo(restored.scrollTop);
		panelScroll.current?.scrollTo(restored.panelScrollTop);
		pendingViewProgress.current = null;
		setCurrent(next);
		setSelectedFile(restored.selectedFile);
		setSelectedHunkIndex(restored.selectedHunk);
		setSelectedKeyChange(restored.selectedKeyChange);
		setCollapsedFiles(new Set(restored.collapsedFiles));
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
		changePanelWidth(resolvePanelWidth(width, event.x + 1));
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
			THEMES.findIndex((candidate) => candidate.id === chosenTheme.id),
		);
		setThemePicker({ selected });
		setPreviewTheme(null);
	}
	function moveThemePreview(delta: number) {
		if (!themePicker) return;
		const selected = (themePicker.selected + delta + THEMES.length) % THEMES.length;
		setThemePicker({ selected });
		setPreviewTheme(THEMES[selected] ?? null);
	}
	function chooseTheme(index: number) {
		const next = THEMES[index];
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
		showHelp,
		viewMode,
		semanticLoading,
		fileDisplay,
		sidebarPreference,
		diffPreference,
		splitReachable,
		setFileDisplay: changeFileDisplay,
		setSidebarPreference: changeSidebarPreference,
		setDiffPreference: changeDiffPreference,
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
	});
	const menu = useMenuController(menus);
	const contextMenuEntries = contextMenu
		? buildRangeMenu({
				selectedText: contextMenu.selectedText,
				linkBlocker: permalinkBlocker({ context: permalinks, side: contextMenu.range.side }),
				copyText: () => {
					if (contextMenu.selectedText) copyText(contextMenu.selectedText);
				},
				copyLocation: () => copyLocation(contextMenu.range),
				copyLink: () => copyLink(contextMenu.range),
				comment: () => selectThreadRange(contextMenu.range),
			})
		: [];
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

	useKeyboard((key) => {
		const name = key.name;
		const paths = chapter ? chapterFilePaths(chapter) : [];

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

		if (APP_KEYS.has(name) || menu.activeMenuId || themePicker || (name && /^[1-9]$/.test(name))) {
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
		if (copyNotice) setCopyNotice(null);

		if (name === "?") {
			toggleShortcutHelp();
		} else if (name === "s") {
			toggleSidebar();
		} else if (name === "t") {
			openThemePicker();
		} else if (name === "y") {
			const text = highlightedText();
			if (text) copyText(text);
		} else if (name === "q" || name === "escape") {
			quit();
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
				{showChapterPanel ? null : (
					<PageNavStrip
						page={page}
						pages={pages}
						current={current}
						chapterCount={chapters.length}
						reviewed={reviewed}
						width={width}
						vs={vs}
						onNavigatePage={goto}
						onToggleChapterReview={toggleChapterReview}
					/>
				)}
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
							onToggleIndex={() => changeIndexExpanded(!indexExpanded)}
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
							trackOptions: { foregroundColor: theme.border },
						}}
					>
						<box flexDirection="column" width="100%">
							{semanticNotice ? <text fg={theme.badgeModified}>{semanticNotice}</text> : null}
							{chapter && !showChapterPanel ? (
								<box flexDirection="column" width="100%" paddingBottom={1}>
									<ChapterBrief
										chapter={chapter}
										vs={vs}
										selectedFile={selectedFile}
										selectedKeyChange={selectedKeyChange}
										stats={stats}
										onSelectFile={selectFile}
										onFocusKeyChange={focusKeyChange}
										onToggleFileReview={toggleFileReview}
										onToggleKeyChange={toggleSelectedKeyChange}
									/>
									<text fg={theme.border}>{"─".repeat(Math.max(1, contentWidth))}</text>
								</box>
							) : null}
							{page?.kind === "prologue" ? (
								<PrologueView prologue={page.prologue} pages={pages} vs={vs} onSelectPage={goto} />
							) : null}
							{page?.kind === "chapter" && viewMode === "patch" ? (
								<ChapterView
									chapter={page.chapter}
									diffTheme={diffTheme}
									diffFiles={diffFiles}
									width={contentWidth}
									diffPreference={diffPreference}
									fileDisplay={fileDisplay}
									splitFits={splitFits}
									vs={vs}
									selectedFile={selectedFile}
									selectedHunkIndex={selectedHunkIndex}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									threads={threads}
									selectedThreadRange={
										contextMenu?.range ??
										(threadDraft?.kind === "thread" ? threadDraft.range : undefined)
									}
									threadDraft={newThreadDraft}
									replyDraft={replyDraft}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
									onSelectThreadRange={selectThreadRange}
									onRangeContextMenu={openRangeContextMenu}
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
									diffTheme={diffTheme}
									diffFiles={diffFiles ?? null}
									width={contentWidth}
									diffPreference={diffPreference}
									fileDisplay={fileDisplay}
									splitFits={splitFits}
									vs={vs}
									selectedFile={selectedFile}
									selectedKeyChange={selectedKeyChange}
									collapsedFiles={collapsedFiles}
									threads={threads}
									selectedThreadRange={
										contextMenu?.range ??
										(threadDraft?.kind === "thread" ? threadDraft.range : undefined)
									}
									threadDraft={newThreadDraft}
									replyDraft={replyDraft}
									onSelectFile={selectFile}
									onToggleCollapse={toggleCollapsedFile}
									onToggleFileReview={toggleFileReview}
									onSelectThreadRange={selectThreadRange}
									onRangeContextMenu={openRangeContextMenu}
									onReplyThread={startThreadReply}
									onDeleteThread={deleteInlineThread}
									onDeleteThreadMessage={deleteInlineThreadMessage}
									onToggleThreadStatus={toggleInlineThreadStatus}
								/>
							) : null}
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
				{showHelp ? (
					<HelpModal
						terminalWidth={width}
						terminalHeight={height}
						scrollRef={helpScroll}
						onClose={() => setShowHelp(false)}
					/>
				) : null}
				{themePicker ? (
					<>
						<ThemePickerBackdrop onClose={closeThemePicker} />
						<ThemePicker
							themes={THEMES}
							selectedIndex={themePicker.selected}
							activeThemeId={chosenTheme.id}
							terminalWidth={width}
							terminalHeight={height}
							onPick={chooseTheme}
						/>
					</>
				) : null}
				{!threadDraft && threadNotice ? <text fg={theme.badgeRemoved}>{threadNotice}</text> : null}
				{copyNotice && !threadDraft ? (
					<text fg={theme.badgeAdded} wrapMode="none" truncate>
						{copyNotice.text}
					</text>
				) : null}
				<box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="column">
					<text fg={theme.muted}>
						{`${current + 1}/${pages.length} · j/k scroll · d/u half-page · space/b page · g/G top/bottom`}
					</text>
					<text fg={theme.muted}>
						{
							"drag gutter thread · drag code + y copy · right-click menu · F10 menu · ]c/[c page · tab file · f/x review · ? help · q quit"
						}
					</text>
				</box>
			</box>
		</ThemeProvider>
	);
}

const THEME_MODE_TIMEOUT_MS = 100;

/** Boot the interactive TUI for a loaded chapters file. Resolves when the user quits. */
export async function runApp(
	file: RevueChaptersFile,
	options: {
		diffFiles?: DiffFile[] | null;
		loadSemanticDiff?: () => Promise<SemanticDiffResult>;
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
		transparentSurfaces?: boolean;
		onViewStateChange?: (next: ViewState) => void;
		onSessionStateChange?: (next: ReviewSessionState) => void;
		onPreferencesChange?: (next: Preferences) => void;
		onThemeChange?: (next: Theme) => void;
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
				diffFiles={options.diffFiles ?? null}
				loadSemanticDiff={options.loadSemanticDiff}
				initialViewState={options.initialViewState}
				initialSessionState={options.initialSessionState}
				initialPreferences={options.initialPreferences}
				initialTheme={initialTheme}
				initialSyntaxTheme={options.initialSyntaxTheme}
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
			/>,
		);
		await quitting;
	} finally {
		root.unmount();
		renderer.destroy();
	}
}
