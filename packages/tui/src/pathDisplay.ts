// How file paths render across the Files surface and story headers. "smart"
// hoists the common directory prefix and abbreviates the rest fish-style,
// "tree" nests directories, "full" leaves paths untouched.

export const PATH_DISPLAY_MODES = ["smart", "tree", "full"] as const;
export type PathDisplayMode = (typeof PATH_DISPLAY_MODES)[number];

export const nextPathDisplayMode = (mode: PathDisplayMode): PathDisplayMode =>
	PATH_DISPLAY_MODES[(PATH_DISPLAY_MODES.indexOf(mode) + 1) % PATH_DISPLAY_MODES.length] ?? "smart";

const ELLIPSIS = "…";
const RENAME_ARROW = " -> ";

const sharedCount = (a: string[], b: string[]): number => {
	const limit = Math.min(a.length, b.length);
	let count = 0;
	for (let index = 0; index < limit && a[index] === b[index]; index += 1) count += 1;
	return count;
};

/** Longest directory prefix (with trailing slash) shared by every path. */
export const commonDirPrefix = (paths: string[]): string => {
	const first = paths[0];
	if (first === undefined) return "";
	const prefix = paths.reduce(
		(shared, path) => shared.slice(0, sharedCount(shared, path.split("/").slice(0, -1))),
		first.split("/").slice(0, -1),
	);
	return prefix.length ? `${prefix.join("/")}/` : "";
};

// Dotfile directories keep two characters so ".github" stays distinct from ".".
const shortenSegment = (segment: string): string =>
	segment.startsWith(".") ? segment.slice(0, 2) : segment.slice(0, 1);

/**
 * Fit a path into `width` without sacrificing the filename: directories
 * abbreviate to their first letter, outermost first, and only when every
 * directory is down to a letter does the tail get cut.
 */
export const abbreviatePath = ({ path, width }: { path: string; width: number }): string => {
	if (width <= 0) return "";
	if (path.length <= width) return path;
	const segments = path.split("/");
	const dirs = segments.slice(0, -1);
	const file = segments.at(-1) ?? "";
	for (let cut = 1; cut <= dirs.length; cut += 1) {
		const candidate = [...dirs.slice(0, cut).map(shortenSegment), ...dirs.slice(cut), file].join(
			"/",
		);
		if (candidate.length <= width) return candidate;
	}
	const collapsed = [...dirs.map(shortenSegment), file].join("/");
	if (collapsed.length <= width) return collapsed;
	return width === 1 ? ELLIPSIS : `${collapsed.slice(0, width - 1)}${ELLIPSIS}`;
};

/** Abbreviate a header path, splitting `old -> new` rename pairs fairly. */
export const formatDisplayPath = ({ path, width }: { path: string; width: number }): string => {
	if (path.length <= width) return path;
	if (!path.includes(RENAME_ARROW)) return abbreviatePath({ path, width });
	const [previous = "", next = ""] = path.split(RENAME_ARROW);
	const budget = Math.max(2, width - RENAME_ARROW.length);
	const nextPart = abbreviatePath({
		path: next,
		width: Math.max(Math.floor(budget / 2), budget - previous.length),
	});
	const previousPart = abbreviatePath({ path: previous, width: budget - nextPart.length });
	return `${previousPart}${RENAME_ARROW}${nextPart}`;
};

export type PathTreeRow =
	| { kind: "dir"; depth: number; label: string }
	| { kind: "file"; depth: number; label: string; path: string };

type TreeNode = {
	dirs: Map<string, TreeNode>;
	files: { name: string; path: string }[];
};

const emptyNode = (): TreeNode => ({ dirs: new Map(), files: [] });

const flattenTree = (node: TreeNode, depth: number, rows: PathTreeRow[]): void => {
	for (const [name, child] of node.dirs) {
		// Single-child directory chains collapse into one row so monorepo
		// scaffolding (packages/website/src/…) costs one line, not four.
		const chain = [name];
		let tip = child;
		while (tip.files.length === 0 && tip.dirs.size === 1) {
			const [nextName, nextChild] = [...tip.dirs.entries()][0] as [string, TreeNode];
			chain.push(nextName);
			tip = nextChild;
		}
		rows.push({ kind: "dir", depth, label: `${chain.join("/")}/` });
		flattenTree(tip, depth + 1, rows);
	}
	for (const file of node.files) {
		rows.push({ kind: "file", depth, label: file.name, path: file.path });
	}
};

/** Directory tree rows for the Files surface, in each path's first-seen order. */
export const buildPathTree = (paths: string[]): PathTreeRow[] => {
	const root = emptyNode();
	for (const path of paths) {
		const segments = path.split("/");
		const node = segments.slice(0, -1).reduce((current, segment) => {
			const child = current.dirs.get(segment) ?? emptyNode();
			current.dirs.set(segment, child);
			return child;
		}, root);
		node.files.push({ name: segments.at(-1) ?? path, path });
	}
	const rows: PathTreeRow[] = [];
	flattenTree(root, 0, rows);
	return rows;
};
