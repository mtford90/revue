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
/** An id, then whichever bracket form carries its label; `((round))` before `(round)`. */
const NODE_REF = /^([A-Za-z0-9_.]+)\s*(?:\(\(([^)]*)\)\)|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/;
/** `-- text -->`: the label sits inside the link rather than after it. */
const INLINE_LABEL_LINK = /^(?:--|==|-\.)\s*([^|<>]+?)\s*(-->|---|==>|===|\.->)/;
/** A bare link, optionally carrying `|text|`. */
const PLAIN_LINK = /^(-->|---|-\.->|-\.-|==>|===)(?:\|([^|]*)\|)?/;

const unquote = (label: string): string => label.trim().replace(/^"(.*)"$/s, "$1").trim();

/** Statements as Mermaid separates them: `%%` comments dropped, `;` ending a statement. */
const statements = (source: readonly string[]): string[] =>
	source
		.flatMap((line) => line.replace(/%%.*$/, "").split(";"))
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);

type NodeRef = { id: string; label: string | null; rest: string };

const readNodeRef = (text: string): NodeRef | null => {
	const match = NODE_REF.exec(text);
	const id = match?.[1];
	if (!match || id === undefined) return null;
	const label = match.slice(2).find((group) => group !== undefined);
	return {
		id,
		label: label === undefined ? null : unquote(label),
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

/** Nodes are collected in declaration order; the first label a node is given is the one kept. */
const recordNode = (nodes: Map<string, string>, ref: NodeRef): void => {
	const existing = nodes.get(ref.id);
	if (existing === undefined || (existing === ref.id && ref.label)) {
		nodes.set(ref.id, ref.label ?? ref.id);
	}
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
	for (const statement of rest) {
		if (!readStatement(statement, nodes, edges)) return null;
	}
	if (nodes.size === 0) return null;
	return {
		direction: (declaration[1]?.toUpperCase() as MermaidDirection | undefined) ?? "TD",
		nodes: [...nodes].map(([id, label]) => ({ id, label })),
		edges,
	};
};
