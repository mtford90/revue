import { type DiffFile, type DiffLayout, prepareSyntaxHighlighting } from "@revue/diff";
import { formatAnsiDiffFile } from "@revue/diff-ansi";
import { resolveTheme, type Theme, withTransparentSurfaces } from "@revue/theme";
import { classifyPagerInput } from "./pagerInput.ts";

export type PagingMode = "auto" | "always" | "never";
export type PagerOptions = { paging: PagingMode; pager?: string; width?: number; theme?: string };

const positive = (value: string | undefined): number | undefined =>
	value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
export const resolvePagerWidth = (options: PagerOptions): number =>
	options.width ??
	positive(process.env.LAZYGIT_COLUMNS) ??
	positive(process.env.COLUMNS) ??
	(process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : undefined) ??
	80;

export const layoutForFile = (file: DiffFile, width: number): DiffLayout =>
	width >= 80 && file.stats.additions > 0 && file.stats.deletions > 0 ? "split" : "stack";

export const resolvePagerCommand = (
	options: PagerOptions,
): { command?: string; explicit: boolean; fallbackAllowed: boolean } => {
	const explicit = options.pager !== undefined;
	const configured = options.pager ?? process.env.REVUEDIFF_PAGER ?? process.env.PAGER ?? "less";
	if (!configured.trim() || configured.trim() === "cat")
		return { explicit, fallbackAllowed: !explicit };
	return { command: configured.trim(), explicit, fallbackAllowed: !explicit };
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control parsing is intentional.
const ANSI_SGR = /\x1b\[[0-?]*[ -/]*[@-~]/g;
export const ansiLineCount = (output: string) => {
	const visible = output.replace(ANSI_SGR, "");
	return visible ? visible.split("\n").length : 0;
};
const shouldPage = (mode: PagingMode, output: string): boolean => {
	if (!process.stdout.isTTY || mode === "never") return false;
	if (mode === "always") return true;
	return !process.stdout.rows || ansiLineCount(output) > process.stdout.rows;
};

const pagerTheme = (requested: string | undefined): Theme =>
	withTransparentSurfaces(resolveTheme(requested, null));

export async function formatPagerInput(input: string, options: PagerOptions): Promise<string> {
	const classified = classifyPagerInput(input);
	if (classified.kind === "passthrough") return classified.text;
	const width = resolvePagerWidth(options);
	const theme = pagerTheme(options.theme);
	await prepareSyntaxHighlighting(classified.files, theme.syntaxTheme);
	const files = classified.files.map((file) =>
		formatAnsiDiffFile({ file, layout: layoutForFile(file, width), width, theme }),
	);
	return [classified.preamble, ...files].filter(Boolean).join("\n");
}

const writeDirect = async (output: string): Promise<number> => {
	try {
		await Bun.write(Bun.stdout, output);
		return 0;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EPIPE") return 0;
		throw error;
	}
};

const shellCommandName = (command: string): string | undefined => {
	const match = /^([A-Za-z0-9_./-]+)(?:\s|$)/.exec(command);
	return match?.[1];
};

/** A preflight only handles ordinary commands, preserving a real command's own status 127. */
async function commandExists(command: string): Promise<boolean | undefined> {
	const name = shellCommandName(command);
	if (!name) return undefined;
	const probe = Bun.spawn(["sh", "-c", 'command -v -- "$1" >/dev/null', "sh", name], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await probe.exited) === 0;
}

async function writePager(command: string, output: string): Promise<number> {
	const bareLess = command === "less";
	const child = Bun.spawn(bareLess ? ["less", "-RFK"] : ["sh", "-c", command], {
		stdin: "pipe",
		stdout: "inherit",
		stderr: "inherit",
	});
	// Node and Bun signal listeners receive no signal argument, so each closure owns it.
	const forwardSigint = () => child.kill("SIGINT");
	const forwardSigterm = () => child.kill("SIGTERM");
	process.on("SIGINT", forwardSigint);
	process.on("SIGTERM", forwardSigterm);
	try {
		try {
			await child.stdin.write(output);
			child.stdin.end();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
		}
		return await child.exited;
	} finally {
		process.off("SIGINT", forwardSigint);
		process.off("SIGTERM", forwardSigterm);
	}
}

/** Format the complete buffered stream, then optionally deliver it to a downstream pager. */
export async function runPager(input: string, options: PagerOptions): Promise<number> {
	const output = await formatPagerInput(input, options);
	if (!shouldPage(options.paging, output)) return writeDirect(output);
	const resolved = resolvePagerCommand(options);
	if (!resolved.command) return writeDirect(output);
	if ((await commandExists(resolved.command)) === false) {
		if (resolved.fallbackAllowed) return writeDirect(output);
		throw new Error(`could not start pager ${JSON.stringify(resolved.command)}: command not found`);
	}
	try {
		return await writePager(resolved.command, output);
	} catch (error) {
		if (resolved.fallbackAllowed) return writeDirect(output);
		throw new Error(
			`could not start pager ${JSON.stringify(resolved.command)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
