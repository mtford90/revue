#!/usr/bin/env bun
import { isBundledShikiThemeId } from "@revue/theme";
import {
	discoverConfigPath,
	effectiveConfig,
	initConfig,
	loadConfig,
	type RevuediffConfig,
} from "./config.ts";
import { type PagerOptions, resolvePagerCommand, resolvePagerWidth, runPager } from "./pager.ts";
import { REVUEDIFF_VERSION } from "./version.ts";

const HELP = `revuediff — format Git and unified diffs as safe ANSI output

Usage:
  revuediff [options] < diff.patch
  revuediff config init [--force] [--config <path>]
  revuediff config show [options]
  revuediff --version

Display options (defaults: both off):
  --line-numbers, --no-line-numbers       Show or hide source line-number gutters
  --change-markers, --no-change-markers   Show or hide + and - markers
  --theme <name>                          Bundled theme name or auto
  --width <columns>                       Override detected terminal width for this run

Paging options:
  --paging auto|always|never              Downstream paging mode (default: auto)
  --pager <command>                       Pager command (then REVUEDIFF_PAGER, PAGER, less)

Configuration:
  --config <path>                         Read this TOML file (overrides REVUEDIFF_CONFIG)
  --no-config                             Do not read any config file
  revuediff config init [--force]         Write a commented starter; never overwrites by default
  revuediff config show                   Print effective values and their sources

Unsupported input is emitted in full as sanitised text. Revuediff buffers stdin so an explicit
missing --config is reported before stdin is consumed. Use --paging=never when another host pages.`;

const CONFIG_HELP = `revuediff config — inspect or initialise persistent configuration

Usage:
  revuediff config init [--force] [--config <path>]
  revuediff config show [display/paging options] [--config <path> | --no-config]

Commands:
  init    Create parent directories and a commented starter; --force permits overwrite
  show    Print the selected path, effective values, and each value's source

The default path is $XDG_CONFIG_HOME/revuediff/config.toml, falling back to
~/.config/revuediff/config.toml. REVUEDIFF_CONFIG overrides discovery; --config outranks it.

TOML keys:
  [display] line-numbers, change-markers, theme
  [paging]  mode (auto, always, or never)

Width and the pager command are session/environment values and are never persisted.`;

type Command = "pager" | "config-init" | "config-show";
type Parsed = {
	command: Command;
	configPath?: string;
	noConfig: boolean;
	force: boolean;
	cli: Partial<RevuediffConfig>;
	pager?: string;
	width?: number;
};

const expandEquals = (args: string[]): string[] =>
	args.flatMap((argument) => {
		const match = /^(--(?:paging|pager|width|theme|config))=(.*)$/.exec(argument);
		return match ? [match[1] as string, match[2] as string] : [argument];
	});

const parseArgs = (args: string[]): Parsed => {
	const parsedArgs = expandEquals(args);
	let command: Command = "pager";
	let force = false;
	let configPath: string | undefined;
	let noConfig = false;
	let pager: string | undefined;
	let width: number | undefined;
	const cli: Partial<RevuediffConfig> = {};
	const specified = new Set<string>();
	const once = (name: string) => {
		if (specified.has(name)) throw new Error(`${name} may only be specified once`);
		specified.add(name);
	};
	const scalar = (name: string, index: number): [string, number] => {
		once(name);
		const value = parsedArgs[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
		return [value, index + 1];
	};

	for (let index = 0; index < parsedArgs.length; index += 1) {
		const argument = parsedArgs[index];
		if (argument === "config") {
			if (command !== "pager") throw new Error("config command may only be specified once");
			const action = parsedArgs[++index];
			if (action === "init") command = "config-init";
			else if (action === "show") command = "config-show";
			else throw new Error("revuediff config requires init or show");
		} else if (argument === "--line-numbers" || argument === "--no-line-numbers") {
			once("--line-numbers");
			cli.lineNumbers = argument === "--line-numbers";
		} else if (argument === "--change-markers" || argument === "--no-change-markers") {
			once("--change-markers");
			cli.changeMarkers = argument === "--change-markers";
		} else if (argument === "--paging") {
			const [value, next] = scalar("--paging", index);
			index = next;
			if (value !== "auto" && value !== "always" && value !== "never")
				throw new Error("--paging must be auto, always, or never");
			cli.paging = value;
		} else if (argument === "--pager") {
			[pager, index] = scalar("--pager", index);
		} else if (argument === "--width") {
			const [value, next] = scalar("--width", index);
			index = next;
			if (!/^[1-9]\d*$/.test(value)) throw new Error("--width requires a positive integer");
			width = Number(value);
		} else if (argument === "--theme") {
			const [value, next] = scalar("--theme", index);
			index = next;
			if (value !== "auto" && !isBundledShikiThemeId(value))
				throw new Error(`unknown theme: ${value}`);
			cli.theme = value;
		} else if (argument === "--config") {
			once("--config");
			[configPath, index] = scalar("--config-path", index);
		} else if (argument === "--no-config") {
			once("--config");
			noConfig = true;
		} else if (argument === "--force") {
			once("--force");
			force = true;
		} else {
			throw new Error(
				argument?.startsWith("-")
					? `unknown revuediff option: ${argument}`
					: "revuediff takes no positional arguments",
			);
		}
	}
	if (force && command !== "config-init") throw new Error("--force is only valid with config init");
	if (noConfig && command === "config-init")
		throw new Error("--no-config cannot be used with config init");
	if (
		command === "config-init" &&
		(Object.keys(cli).length > 0 || pager !== undefined || width !== undefined)
	)
		throw new Error("display and paging options are not valid with config init");
	return { command, configPath, noConfig, force, cli, pager, width };
};

const sourceForPager = (pager?: string): string => {
	if (pager !== undefined) return "cli";
	if (process.env.REVUEDIFF_PAGER !== undefined) return "REVUEDIFF_PAGER";
	if (process.env.PAGER !== undefined) return "PAGER";
	return "built-in";
};

const showConfig = (
	path: string | undefined,
	discovery: string,
	config: ReturnType<typeof effectiveConfig>,
	options: PagerOptions,
): string => {
	const resolvedPager = resolvePagerCommand(options).command ?? "direct output";
	return [
		`path: ${path ?? "disabled"} (${discovery})`,
		`display.line-numbers: ${config.lineNumbers} (${config.sources.lineNumbers})`,
		`display.change-markers: ${config.changeMarkers} (${config.sources.changeMarkers})`,
		`display.theme: ${config.theme} (${config.sources.theme})`,
		`paging.mode: ${config.paging} (${config.sources.paging})`,
		`paging.pager: ${resolvedPager} (${sourceForPager(options.pager)})`,
		`display.width: ${resolvePagerWidth(options)} (${options.width !== undefined ? "cli" : "environment/terminal"})`,
	].join("\n");
};

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${args.includes("config") ? CONFIG_HELP : HELP}\n`);
		return 0;
	}
	if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
		process.stdout.write(`revuediff ${REVUEDIFF_VERSION}\n`);
		return 0;
	}
	let parsed: Parsed;
	try {
		parsed = parseArgs(args);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${HELP}\n`);
		return 1;
	}
	const discovery = discoverConfigPath({
		cliPath: parsed.configPath,
		disabled: parsed.noConfig,
	});
	if (parsed.command === "config-init") {
		if (!discovery.path) {
			process.stderr.write("config init requires an enabled config path\n");
			return 1;
		}
		try {
			await initConfig(discovery.path, parsed.force);
			process.stdout.write(`${discovery.path}\n`);
			return 0;
		} catch (error) {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			return 1;
		}
	}
	let loaded: Awaited<ReturnType<typeof loadConfig>>;
	try {
		loaded = await loadConfig({
			path: discovery.path,
			required: discovery.explicit === "cli",
			warnMissing: discovery.explicit === "environment",
		});
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
	for (const warning of loaded.warnings) process.stderr.write(`warning: ${warning}\n`);
	const config = effectiveConfig(loaded.values, parsed.cli);
	const options: PagerOptions = {
		paging: config.paging,
		lineNumbers: config.lineNumbers,
		changeMarkers: config.changeMarkers,
		theme: config.theme,
		pager: parsed.pager,
		width: parsed.width,
	};
	if (parsed.command === "config-show") {
		process.stdout.write(`${showConfig(discovery.path, discovery.explicit, config, options)}\n`);
		return 0;
	}
	if (process.stdin.isTTY) {
		process.stderr.write(`revuediff requires a diff on stdin\n${HELP}\n`);
		return 1;
	}
	try {
		return await runPager(await Bun.stdin.text(), options);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

if (import.meta.main) {
	main()
		.then((code) => {
			if (code !== 0) process.exit(code);
		})
		.catch((error) => {
			process.stderr.write(
				`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
			);
			process.exit(1);
		});
}
