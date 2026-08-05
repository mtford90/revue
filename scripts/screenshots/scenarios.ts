// Diff shapes worth looking at side by side: each scenario is a base tree plus the working-tree
// edit revue will be asked to render. Modelled on the codediff testing matrix.

export type Scenario = {
	id: string;
	summary: string;
	/** Files as committed. */
	base: Record<string, string>;
	/** Files as left in the working tree; only the changed ones need listing. */
	head: Record<string, string>;
	/** Extra keys to press before the second screenshot, proving the view scrolls. */
	pagedShot?: boolean;
};

const CART_BASE = `export type Line = { sku: string; qty: number; price: number };

export const rate = 0.15;

export const subtotal = (lines: Line[]): number =>
	lines.reduce((sum, line) => sum + line.qty * line.price, 0);

export const tax = (amount: number): number => amount * rate;

export const total = (lines: Line[]): number => {
	const net = subtotal(lines);
	return net + tax(net);
};
`;

const singleChar: Scenario = {
	id: "single-char",
	summary: "one character changes inside a numeric literal",
	base: { "cart.ts": CART_BASE },
	head: { "cart.ts": CART_BASE.replace("rate = 0.15", "rate = 0.16") },
};

const wordEdit: Scenario = {
	id: "word-edit",
	summary: "one identifier changes inside an otherwise identical line",
	base: { "cart.ts": CART_BASE },
	head: {
		"cart.ts": CART_BASE.replace("const net = subtotal(lines);", "const net = netTotal(lines);"),
	},
};

const multiEdit: Scenario = {
	id: "multi-edit-line",
	summary: "three separate edits inside a single line",
	base: {
		"report.ts": `export const render = (rows: Row[]): string => {
	const summary = buildSummary(rows, { locale: "en-GB", currency: "GBP", rounding: "half-up" });
	return summary.join("\\n");
};
`,
	},
	head: {
		"report.ts": `export const render = (rows: Row[]): string => {
	const digest = buildDigest(rows, { locale: "en-IE", currency: "EUR", rounding: "half-even" });
	return digest.join("\\n");
};
`,
	},
};

const unequalCount: Scenario = {
	id: "unequal-block",
	summary: "one line becomes two, then an equal-count block whose lines are unrelated",
	base: {
		"router.ts": `export const route = (request: Request): Response => {
	const path = new URL(request.url).pathname;
	const method = request.method.toUpperCase();
	if (path === "/health") return json({ ok: true });
	return notFound();
};
`,
	},
	head: {
		"router.ts": `export const route = (request: Request): Response => {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method.toUpperCase();
	if (probePaths.has(path)) return json({ ok: true, checkedAt: Date.now() });
	return notFound();
};
`,
	},
};

const whitespaceOnly: Scenario = {
	id: "whitespace-only",
	summary: "trailing whitespace and re-indentation, no visible token changes",
	base: {
		"format.ts": `export const shout = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.toUpperCase();
};
`,
	},
	head: {
		"format.ts": `export const shout = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    return trimmed.toUpperCase();
};
`,
	},
};

const unicode: Scenario = {
	id: "unicode",
	summary: "emoji, CJK and combining marks on changed lines",
	base: {
		"labels.ts": `export const labels = {
	shipped: "📦 Shipped",
	pending: "⏳ 待处理",
	failed: "❌ Échec",
	done: "✅ 完了",
	note: "café — naïve",
};
`,
	},
	head: {
		"labels.ts": `export const labels = {
	shipped: "🚚 Dispatched",
	pending: "⏳ 处理中",
	failed: "❌ Échoué",
	done: "✅ 完了しました",
	note: "café — naïve",
};
`,
	},
};

const LONG_ARGUMENTS = Array.from(
	{ length: 24 },
	(_, index) => `option${index}: ${index % 2 === 0 ? "true" : "false"}`,
).join(", ");

const longLines: Scenario = {
	id: "long-lines",
	summary: "a 300+ character line with a small edit in the middle",
	base: {
		"config.ts": `export const config = { ${LONG_ARGUMENTS}, retries: 3, endpoint: "https://example.invalid/api/v1/resource/collection?expand=all&include=metadata" };
export const shortLine = 1;
`,
	},
	head: {
		"config.ts": `export const config = { ${LONG_ARGUMENTS.replace("option12: true", "option12: false")}, retries: 5, endpoint: "https://example.invalid/api/v1/resource/collection?expand=all&include=metadata" };
export const shortLine = 1;
`,
	},
};

const MOVED_HELPER = `const formatMoney = (pennies: number): string => {
	const pounds = Math.floor(pennies / 100);
	const remainder = \`\${pennies % 100}\`.padStart(2, "0");
	return \`£\${pounds}.\${remainder}\`;
};
`;

const MOVED_MAIN = `export const invoiceLine = (label: string, pennies: number): string =>
	\`\${label}: \${formatMoney(pennies)}\`;

export const invoiceTotal = (pennies: number[]): string =>
	formatMoney(pennies.reduce((sum, value) => sum + value, 0));
`;

const movedBlock: Scenario = {
	id: "moved-block",
	summary: "a helper block moves from the top of the file to the bottom",
	base: { "invoice.ts": `${MOVED_HELPER}\n${MOVED_MAIN}` },
	head: { "invoice.ts": `${MOVED_MAIN}\n${MOVED_HELPER}` },
};

const mixedRealistic: Scenario = {
	id: "mixed-typescript",
	summary: "a realistic multi-hunk TypeScript change of the kind a reviewer sees daily",
	base: {
		"session.ts": `import { readFile } from "node:fs/promises";
import { z } from "zod";

const SessionSchema = z.object({
	id: z.string(),
	user: z.string(),
	expiresAt: z.number(),
});

export type Session = z.infer<typeof SessionSchema>;

export const loadSession = async (path: string): Promise<Session | null> => {
	const raw = await readFile(path, "utf8");
	const parsed = SessionSchema.safeParse(JSON.parse(raw));
	if (!parsed.success) {
		console.error("bad session file", parsed.error);
		return null;
	}
	return parsed.data;
};

export const isExpired = (session: Session): boolean => session.expiresAt < Date.now();

export const describe = (session: Session): string => {
	if (isExpired(session)) {
		return \`session \${session.id} expired\`;
	}
	return \`session \${session.id} for \${session.user}\`;
};
`,
	},
	head: {
		"session.ts": `import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const SessionSchema = z.object({
	id: z.string(),
	user: z.string(),
	scopes: z.array(z.string()).default([]),
	expiresAt: z.number(),
});

export type Session = z.infer<typeof SessionSchema>;

export const loadSession = async (directory: string, id: string): Promise<Session | null> => {
	const raw = await readFile(join(directory, \`\${id}.json\`), "utf8");
	const parsed = SessionSchema.safeParse(JSON.parse(raw));
	if (!parsed.success) return null;
	return parsed.data;
};

export const isExpired = (session: Session, now = Date.now()): boolean => session.expiresAt < now;

export const describe = (session: Session): string => {
	if (isExpired(session)) return \`session \${session.id} expired\`;
	const scopes = session.scopes.join(", ") || "none";
	return \`session \${session.id} for \${session.user} (\${scopes})\`;
};
`,
	},
};

const legacyLine = (index: number): string =>
	`	legacy.step${index}(context, { attempt: ${index}, retry: ${index % 3 === 0} });`;

const LEGACY_BLOCK = Array.from({ length: 300 }, (_, index) => legacyLine(index)).join("\n");

const hugeHunk: Scenario = {
	id: "huge-hunk",
	summary: "a 300-line deletion block, for windowing and scroll behaviour",
	base: {
		"pipeline.ts": `export const run = (context: Context): void => {
${LEGACY_BLOCK}
	finalise(context);
};
`,
	},
	head: {
		"pipeline.ts": `export const run = (context: Context): void => {
	modern.runAll(context);
	finalise(context);
};
`,
	},
	pagedShot: true,
};

export const SCENARIOS: Scenario[] = [
	singleChar,
	wordEdit,
	multiEdit,
	unequalCount,
	whitespaceOnly,
	unicode,
	longLines,
	movedBlock,
	mixedRealistic,
	hugeHunk,
];
