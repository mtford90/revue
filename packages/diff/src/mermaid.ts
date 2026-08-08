// A terminal has no Mermaid renderer, so a flowchart is parsed into a graph here and drawn as
// ASCII art elsewhere. The subset is deliberately narrow: anything this parser cannot account
// for returns null, which is what lets the caller show the author's own source untouched
// rather than a half-drawn picture.

/** Declared reading direction. It is recorded but does not survive into the drawing. */
export type MermaidDirection = "TD" | "TB" | "BT" | "LR" | "RL";

export type MermaidNode = { id: string; label: string };

/** `arrow` is false for an undirected link (`---`), which draws without a head. */
export type MermaidEdge = { from: string; to: string; label: string | null; arrow: boolean };

export type MermaidFlowchart = {
	direction: MermaidDirection;
	nodes: readonly MermaidNode[];
	edges: readonly MermaidEdge[];
};

const HEADER = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?$/i;
/** A direction of its own, which Mermaid allows as a statement. Recorded, never drawn from. */
const DIRECTION = /^direction\s+(TB|TD|BT|RL|LR)$/i;
/**
 * An id, then whichever bracket form carries its label; `((round))` before `(round)`. A hyphen
 * only continues an id when a word character follows it, so `api-client --> backend` reads as two
 * ids rather than swallowing the link.
 */
const NODE_REF =
	/^([A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*)\s*(?:\(\(([^)]*)\)\)|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/;
/** `-- text -->`: the label sits inside the link rather than after it. */
const INLINE_LABEL_LINK = /^(?:--|==|-\.)\s*([^|<>]+?)\s*(-->|---|==>|===|\.->)/;
/** A bare link, optionally carrying `|text|`. */
const PLAIN_LINK = /^(-->|---|-\.->|-\.-|==>|===)(?:\|([^|]*)\|)?/;

const unquote = (label: string): string =>
	label
		.trim()
		.replace(/^"(.*)"$/s, "$1")
		.trim();

/** Where an unquoted `%%` comment starts, or the line's end. A quoted label may hold either. */
const commentStart = (line: string): number => {
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"') quoted = !quoted;
		else if (!quoted && char === "%" && line[index + 1] === "%") return index;
	}
	return line.length;
};

/** One line's statements: a `;` ends one, unless it is inside a quoted label. */
const splitStatements = (line: string): string[] => {
	let quoted = false;
	return [...line.slice(0, commentStart(line))]
		.map((char) => {
			if (char === '"') quoted = !quoted;
			return char === ";" && !quoted ? "\n" : char;
		})
		.join("")
		.split("\n");
};

/** Statements as Mermaid separates them, comments dropped and blank lines discarded. */
const statements = (source: readonly string[]): string[] =>
	source
		.flatMap(splitStatements)
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);

type NodeRef = { id: string; label: string | null; rest: string };

const readNodeRef = (text: string): NodeRef | null => {
	const match = NODE_REF.exec(text);
	const id = match?.[1];
	if (!match || id === undefined) return null;
	const label = unquote(match.slice(2).find((group) => group !== undefined) ?? "");
	return {
		id,
		label: label === "" ? null : label,
		rest: text.slice(match[0].length).trimStart(),
	};
};

type Link = { label: string | null; arrow: boolean; rest: string };

const readLink = (text: string): Link | null => {
	const inline = INLINE_LABEL_LINK.exec(text);
	if (inline) {
		return {
			label: unquote(inline[1] ?? ""),
			arrow: (inline[2] ?? "").endsWith(">"),
			rest: text.slice(inline[0].length).trimStart(),
		};
	}
	const plain = PLAIN_LINK.exec(text);
	if (!plain) return null;
	const label = plain[2];
	return {
		label: label === undefined ? null : unquote(label),
		arrow: (plain[1] ?? "").endsWith(">"),
		rest: text.slice(plain[0].length).trimStart(),
	};
};

/**
 * Nodes keep the order they are first mentioned in, but a later label replaces an earlier one, as
 * Mermaid's own does: a drawing that contradicts the source it came from is worse than no drawing.
 */
const recordNode = (nodes: Map<string, string>, ref: NodeRef): void => {
	if (ref.label !== null) nodes.set(ref.id, ref.label);
	else if (!nodes.has(ref.id)) nodes.set(ref.id, ref.id);
};

/**
 * One statement: a node on its own, or a chain of nodes joined by links. Returning false is a
 * refusal to guess — the statement is something this subset does not model.
 */
const readStatement = (
	statement: string,
	nodes: Map<string, string>,
	edges: MermaidEdge[],
): boolean => {
	let ref = readNodeRef(statement);
	if (!ref) return false;
	recordNode(nodes, ref);
	for (let rest = ref.rest; rest.length > 0; rest = ref.rest) {
		const link = readLink(rest);
		if (!link) return false;
		const next = readNodeRef(link.rest);
		if (!next) return false;
		recordNode(nodes, next);
		edges.push({ from: ref.id, to: next.id, label: link.label, arrow: link.arrow });
		ref = next;
	}
	return true;
};

/**
 * Parse Mermaid source as a flowchart, or return null for every other diagram type and for any
 * flowchart syntax outside the supported subset.
 */
export const parseMermaidFlowchart = (source: readonly string[]): MermaidFlowchart | null => {
	const [header, ...rest] = statements(source);
	const declaration = header === undefined ? null : HEADER.exec(header);
	if (!declaration) return null;
	const nodes = new Map<string, string>();
	const edges: MermaidEdge[] = [];
	let direction = declaration[1] ?? "TD";
	for (const statement of rest) {
		const redirected = DIRECTION.exec(statement);
		if (redirected) direction = redirected[1] ?? direction;
		else if (!readStatement(statement, nodes, edges)) return null;
	}
	if (nodes.size === 0) return null;
	return {
		direction: direction.toUpperCase() as MermaidDirection,
		nodes: [...nodes].map(([id, label]) => ({ id, label })),
		edges,
	};
};
