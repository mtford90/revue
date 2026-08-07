import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isBundledShikiThemeId } from "@revue/theme";
import { TOML } from "bun";
import type { PagingMode } from "./pager.ts";

export type RevuediffConfig = {
	lineNumbers: boolean;
	changeMarkers: boolean;
	theme: string;
	paging: PagingMode;
};

export const DEFAULT_CONFIG: RevuediffConfig = {
	lineNumbers: false,
	changeMarkers: false,
	theme: "ayu-dark",
	paging: "auto",
};

export type ConfigSource = "built-in" | "config" | "cli";
export type EffectiveConfig = RevuediffConfig & {
	sources: Record<keyof RevuediffConfig, ConfigSource>;
};

export const defaultConfigPath = (env: NodeJS.ProcessEnv = process.env): string =>
	join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "revuediff", "config.toml");

export const discoverConfigPath = ({
	cliPath,
	disabled,
	env = process.env,
}: {
	cliPath?: string;
	disabled?: boolean;
	env?: NodeJS.ProcessEnv;
}): { path?: string; explicit: "cli" | "environment" | "default" | "disabled" } => {
	if (disabled) return { explicit: "disabled" };
	if (cliPath) return { path: resolve(cliPath), explicit: "cli" };
	if (env.REVUEDIFF_CONFIG) return { path: resolve(env.REVUEDIFF_CONFIG), explicit: "environment" };
	return { path: defaultConfigPath(env), explicit: "default" };
};

const object = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const warning = (path: string, key: string, expectation: string) =>
	`${path}: ignoring ${key}; expected ${expectation}`;

export const parseConfig = (
	text: string,
	path = "config.toml",
): { values: Partial<RevuediffConfig>; warnings: string[] } => {
	let parsed: unknown;
	try {
		parsed = TOML.parse(text);
	} catch (error) {
		return {
			values: {},
			warnings: [
				`${path}: malformed TOML; using safe defaults (${error instanceof Error ? error.message : String(error)})`,
			],
		};
	}
	const root = object(parsed);
	if (!root) return { values: {}, warnings: [warning(path, "document", "a TOML table")] };
	const warnings: string[] = [];
	for (const key of Object.keys(root)) {
		if (key !== "display" && key !== "paging") warnings.push(`${path}: unknown key ${key}`);
	}
	const values: Partial<RevuediffConfig> = {};
	const display = object(root.display);
	if (root.display !== undefined && !display) warnings.push(warning(path, "display", "a table"));
	if (display) {
		for (const key of Object.keys(display)) {
			if (key !== "line-numbers" && key !== "change-markers" && key !== "theme")
				warnings.push(`${path}: unknown key display.${key}`);
		}
		if (display["line-numbers"] !== undefined) {
			if (typeof display["line-numbers"] === "boolean")
				values.lineNumbers = display["line-numbers"];
			else warnings.push(warning(path, "display.line-numbers", "a boolean"));
		}
		if (display["change-markers"] !== undefined) {
			if (typeof display["change-markers"] === "boolean")
				values.changeMarkers = display["change-markers"];
			else warnings.push(warning(path, "display.change-markers", "a boolean"));
		}
		if (display.theme !== undefined) {
			if (
				typeof display.theme === "string" &&
				(display.theme === "auto" || isBundledShikiThemeId(display.theme))
			)
				values.theme = display.theme;
			else warnings.push(warning(path, "display.theme", "a bundled theme name or auto"));
		}
	}
	const paging = object(root.paging);
	if (root.paging !== undefined && !paging) warnings.push(warning(path, "paging", "a table"));
	if (paging) {
		for (const key of Object.keys(paging)) {
			if (key !== "mode") warnings.push(`${path}: unknown key paging.${key}`);
		}
		if (paging.mode !== undefined) {
			if (paging.mode === "auto" || paging.mode === "always" || paging.mode === "never")
				values.paging = paging.mode;
			else warnings.push(warning(path, "paging.mode", "auto, always, or never"));
		}
	}
	return { values, warnings };
};

export const loadConfig = async ({
	path,
	required,
	warnMissing = false,
}: {
	path?: string;
	required: boolean;
	warnMissing?: boolean;
}): Promise<{ values: Partial<RevuediffConfig>; warnings: string[] }> => {
	if (!path) return { values: {}, warnings: [] };
	try {
		return parseConfig(await readFile(path, "utf8"), path);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (required) throw new Error(`cannot read config ${path}: ${detail}`);
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return {
				values: {},
				warnings: warnMissing ? [`${path}: config path does not exist; using safe defaults`] : [],
			};
		return {
			values: {},
			warnings: [`${path}: cannot read config; using safe defaults (${detail})`],
		};
	}
};

export const effectiveConfig = (
	file: Partial<RevuediffConfig>,
	cli: Partial<RevuediffConfig>,
): EffectiveConfig => {
	const value = { ...DEFAULT_CONFIG, ...file, ...cli };
	const source = (key: keyof RevuediffConfig): ConfigSource =>
		cli[key] !== undefined ? "cli" : file[key] !== undefined ? "config" : "built-in";
	return {
		...value,
		sources: {
			lineNumbers: source("lineNumbers"),
			changeMarkers: source("changeMarkers"),
			theme: source("theme"),
			paging: source("paging"),
		},
	};
};

export const STARTER_CONFIG = `# Revuediff configuration. Command-line flags override these values.
[display]
# Show source line-number gutters.
line-numbers = false
# Show + and - change markers.
change-markers = false
# Bundled theme name, or "auto" for the safe dark fallback.
theme = "ayu-dark"

[paging]
# One of "auto", "always", or "never".
mode = "auto"
`;

export const initConfig = async (path: string, force: boolean): Promise<void> => {
	if (!force) {
		try {
			await access(path, constants.F_OK);
			throw new Error(`config already exists at ${path}; use --force to overwrite`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, STARTER_CONFIG, { encoding: "utf8", flag: force ? "w" : "wx" });
};
