// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI pointer handlers use text renderables.
/**
 * The full-screen keys surface behind `?`. It floats over the review rather than replacing the
 * page so your place in the diff — and the scroll positions of everything under it — survive.
 *
 * The filter is plain state driven by the app's keyboard handler rather than an `<input>`:
 * `InputRenderable` inherits Textarea's keybindings, so a focused input would fight the list for
 * the arrow keys, and a second focus owner is one more thing that can swallow a global action.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useMemo } from "react";
import type { KeymapIssue } from "./keybindings.ts";
import {
	formatKeymapKey,
	KEYMAP,
	KEYMAP_SURFACE_LABELS,
	KEYMAP_SURFACE_ROUTES,
	type KeymapAction,
	type KeymapGroup,
	type KeymapMatch,
	type KeymapSurface,
	keymapGroups,
	keymapHint,
	searchKeymap,
} from "./keymap.ts";
import { useTheme } from "./theme.ts";
import type { ThemeIssue } from "./themes.ts";

/**
 * One column, never two. A full row is keys (11) + description (up to 61) + id (22) ≈ 98 columns,
 * so side-by-side sections would need a 200-column terminal before the ids stopped being shaved
 * down to nothing — and the ids are the column you need to write `keybindings.json`.
 */
const ID_COLUMN_MIN_WIDTH = 72;
const ID_COLUMN_WIDTH = 24;
/** The surface covers everything between the menu bar and the status bar, leaving both in place. */
const MENU_BAR_ROWS = 1;
const STATUS_BAR_ROWS = 1;

const keyColumnText = (keys: readonly string[]) => keys.join("  ");

/** One shortcut: keys right-aligned into a shared column, primary bright and aliases dimmed. */
function KeyCells({ keys, width }: { keys: readonly string[]; width: number }) {
	const theme = useTheme();
	const pad = Math.max(0, width - keyColumnText(keys).length);
	return (
		<text flexShrink={0} wrapMode="none">
			{" ".repeat(pad)}
			{keys.map((key, index) => (
				<span key={key} fg={index === 0 ? theme.text : theme.muted}>
					{index === 0 ? key : `  ${key}`}
				</span>
			))}
		</text>
	);
}

function ShortcutRow({
	keys,
	description,
	id,
	keyWidth,
	showId,
	dim,
}: {
	keys: readonly string[];
	description: string;
	id: string;
	keyWidth: number;
	showId: boolean;
	dim: boolean;
}) {
	const theme = useTheme();
	return (
		<box flexDirection="row" width="100%" height={1}>
			<KeyCells keys={keys} width={keyWidth} />
			<text
				flexGrow={1}
				flexShrink={1}
				minWidth={0}
				wrapMode="none"
				truncate
				fg={dim ? theme.muted : theme.text}
			>
				{`  ${description}`}
			</text>
			{showId ? (
				<text flexShrink={0} wrapMode="none" fg={theme.muted}>
					{id.padStart(ID_COLUMN_WIDTH)}
				</text>
			) : null}
		</box>
	);
}

function GroupBlock({
	group,
	keyWidth,
	showId,
}: {
	group: KeymapGroup;
	keyWidth: number;
	showId: boolean;
}) {
	const theme = useTheme();
	const dim = group.scope === "elsewhere";
	return (
		<box flexDirection="column" width="100%">
			<text fg={dim ? theme.muted : theme.heading}>{`  ${group.title}`}</text>
			{group.rows.map((row) => (
				<ShortcutRow
					key={row.id}
					keys={row.keys}
					description={row.description}
					id={row.id}
					keyWidth={keyWidth}
					showId={showId}
					dim={dim}
				/>
			))}
			{group.notes.map((note) => (
				<text key={note} fg={theme.muted} wrapMode="none" truncate>
					{`${" ".repeat(keyWidth)}  ${note}`}
				</text>
			))}
		</box>
	);
}

function ScopeHeading({ scope, here }: { scope: "here" | "elsewhere"; here: KeymapSurface }) {
	const theme = useTheme();
	const other: KeymapSurface = here === "page" ? "comments" : "page";
	if (scope === "here")
		return <text fg={theme.accent}>{`Here — ${KEYMAP_SURFACE_LABELS[here]}`}</text>;
	const route = keymapHint(KEYMAP_SURFACE_ROUTES[here]);
	const label = KEYMAP_SURFACE_LABELS[other];
	return (
		<text fg={theme.muted}>
			{route
				? `Elsewhere — ${label} · press ${formatKeymapKey(route)} to get there`
				: `Elsewhere — ${label}`}
		</text>
	);
}

function ScopeBlock({
	scope,
	here,
	groups,
	keyWidth,
	showId,
}: {
	scope: "here" | "elsewhere";
	here: KeymapSurface;
	groups: readonly KeymapGroup[];
	keyWidth: number;
	showId: boolean;
}) {
	if (groups.length === 0) return null;
	return (
		<box flexDirection="column" width="100%" paddingBottom={1}>
			<ScopeHeading scope={scope} here={here} />
			{groups.map((group) => (
				<GroupBlock key={group.title} group={group} keyWidth={keyWidth} showId={showId} />
			))}
		</box>
	);
}

/** Groups collapse under a filter, so each row says where it came from instead. */
const matchTag = (match: KeymapMatch, here: KeymapSurface) =>
	match.scope === "here"
		? match.section
		: KEYMAP_SURFACE_LABELS[here === "page" ? "comments" : "page"];

function MatchList({
	matches,
	here,
	keyWidth,
}: {
	matches: readonly KeymapMatch[];
	here: KeymapSurface;
	keyWidth: number;
}) {
	const theme = useTheme();
	if (matches.length === 0) return <text fg={theme.muted}>{"  nothing matches"}</text>;
	return (
		<box flexDirection="column" width="100%">
			{matches.map((match) => (
				<box key={`${match.scope}-${match.id}`} flexDirection="row" width="100%" height={1}>
					<KeyCells keys={match.keys} width={keyWidth} />
					<text
						flexGrow={1}
						flexShrink={1}
						minWidth={0}
						wrapMode="none"
						truncate
						fg={match.scope === "elsewhere" ? theme.muted : theme.text}
					>
						{`  ${match.description}`}
					</text>
					<text flexShrink={0} wrapMode="none" fg={theme.muted}>
						{`  ${match.id}  ${matchTag(match, here)}`}
					</text>
				</box>
			))}
		</box>
	);
}

function IssueBlock({
	title,
	issues,
}: {
	title: string;
	issues: readonly { entry: string; reason: string }[];
}) {
	const theme = useTheme();
	if (issues.length === 0) return null;
	return (
		<box flexDirection="column" width="100%" paddingBottom={1}>
			<text fg={theme.badgeRemoved}>{title}</text>
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
	);
}

export function HelpSurface({
	surface,
	filter,
	terminalWidth,
	terminalHeight,
	scrollRef,
	keymap = KEYMAP,
	issues = [],
	themeIssues = [],
}: {
	surface: KeymapSurface;
	filter: string;
	terminalWidth: number;
	terminalHeight: number;
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	keymap?: readonly KeymapAction[];
	issues?: readonly KeymapIssue[];
	themeIssues?: readonly ThemeIssue[];
}) {
	const theme = useTheme();
	const groups = useMemo(() => keymapGroups(surface, keymap), [surface, keymap]);
	const matches = useMemo(() => searchKeymap(surface, filter, keymap), [surface, filter, keymap]);
	const keyWidth = useMemo(
		() =>
			groups.reduce(
				(widest, group) =>
					group.rows.reduce(
						(inner, row) => Math.max(inner, keyColumnText(row.keys).length),
						widest,
					),
				0,
			),
		[groups],
	);
	const showId = terminalWidth >= ID_COLUMN_MIN_WIDTH;
	const here = groups.filter((group) => group.scope === "here");
	const elsewhere = groups.filter((group) => group.scope === "elsewhere");
	return (
		<box
			position="absolute"
			top={MENU_BAR_ROWS}
			left={0}
			width="100%"
			height={Math.max(3, terminalHeight - MENU_BAR_ROWS - STATUS_BAR_ROWS)}
			zIndex={50}
			flexDirection="column"
			backgroundColor={theme.background}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<box flexDirection="row" width="100%" height={1} paddingLeft={1} paddingRight={1}>
				<text flexShrink={0} fg={theme.accent}>
					Keys
				</text>
				<box flexGrow={1} />
				<text flexShrink={0} fg={theme.muted}>
					filter:{" "}
				</text>
				<text flexShrink={0} wrapMode="none" fg={theme.text}>
					{`${filter}▏`}
				</text>
			</box>
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
				<IssueBlock title="Keybinding overrides ignored" issues={issues} />
				<IssueBlock title="Theme issues ignored" issues={themeIssues} />
				{filter ? (
					<MatchList matches={matches} here={surface} keyWidth={keyWidth} />
				) : (
					<>
						<ScopeBlock
							scope="here"
							here={surface}
							groups={here}
							keyWidth={keyWidth}
							showId={showId}
						/>
						<ScopeBlock
							scope="elsewhere"
							here={surface}
							groups={elsewhere}
							keyWidth={keyWidth}
							showId={showId}
						/>
					</>
				)}
			</scrollbox>
			<box flexShrink={0} height={1} paddingLeft={1}>
				<text fg={theme.muted} wrapMode="none" truncate>
					{filter
						? "Esc clears the filter · ? or F1 to close"
						: "type to filter · ? or Esc to close · revue keybindings prints every alias"}
				</text>
			</box>
		</box>
	);
}
