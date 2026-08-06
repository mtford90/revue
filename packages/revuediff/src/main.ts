#!/usr/bin/env bun
import { isBundledShikiThemeId } from "@revue/theme";
import { type PagerOptions, runPager } from "./pager.ts";
import { REVUEDIFF_VERSION } from "./version.ts";

const HELP = `revuediff — format Git and unified diffs as safe ANSI output

Usage:
  revuediff [--paging auto|always|never] [--pager <command>]
             [--width <columns>] [--theme <name>]
  revuediff --version

Formats a diff read from stdin. Unsupported input is emitted in full as sanitised text.
Configure Git with: git config --global pager.diff revuediff`;

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write(`${HELP}\n`);
		return 0;
	}
	if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
		process.stdout.write(`revuediff ${REVUEDIFF_VERSION}\n`);
		return 0;
	}
	let options: PagerOptions = { paging: "auto" };
	const specified = new Set<string>();
	const parsedArgs = args.flatMap((argument) => {
		const match = /^(--(?:paging|pager|width|theme))=(.*)$/.exec(argument);
		return match ? [match[1], match[2]] : [argument];
	});
	try {
		for (let index = 0; index < parsedArgs.length; index++) {
			const argument = parsedArgs[index];
			const scalar = (name: "--paging" | "--pager" | "--width" | "--theme") => {
				if (specified.has(name)) throw new Error(`${name} may only be specified once`);
				specified.add(name);
				const value = parsedArgs[++index];
				if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
				return value;
			};
			if (argument === "--paging") {
				const paging = scalar("--paging");
				if (paging !== "auto" && paging !== "always" && paging !== "never")
					throw new Error("--paging must be auto, always, or never");
				options = { ...options, paging };
			} else if (argument === "--pager") options = { ...options, pager: scalar("--pager") };
			else if (argument === "--width") {
				const width = scalar("--width");
				if (!/^[1-9]\d*$/.test(width)) throw new Error("--width requires a positive integer");
				options = { ...options, width: Number(width) };
			} else if (argument === "--theme") {
				const theme = scalar("--theme");
				if (theme !== "auto" && !isBundledShikiThemeId(theme))
					throw new Error(`unknown theme: ${theme}`);
				options = { ...options, theme };
			} else {
				throw new Error(
					argument?.startsWith("-")
						? `unknown revuediff option: ${argument}`
						: "revuediff takes no positional arguments",
				);
			}
		}
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${HELP}\n`);
		return 1;
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
