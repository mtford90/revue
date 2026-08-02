import { RUN_COMPARISON, RUN_SCOPE_MODE, type RunScope } from "@revue/types";

export class PrepArgumentError extends Error {}

export type ScopeRequest = {
	mode: RunScope["mode"] | "auto";
	comparison: typeof RUN_COMPARISON.DIRECT | typeof RUN_COMPARISON.MERGE_BASE;
	baseRef?: string;
	headRef: string;
	explicitRefs: boolean;
};

type ParsedArguments = {
	positionals: string[];
	baseRef?: string;
	compareRef?: string;
	mode: ScopeRequest["mode"];
};

const parseMode = (value: string): ScopeRequest["mode"] => {
	if (Object.values(RUN_SCOPE_MODE).includes(value as RunScope["mode"])) {
		return value as RunScope["mode"];
	}
	throw new PrepArgumentError(`Unknown --ref mode: ${value}`);
};

const parseArguments = (args: string[]): ParsedArguments => {
	const positionals: string[] = [];
	let baseRef: string | undefined;
	let compareRef: string | undefined;
	let mode: ScopeRequest["mode"] = "auto";
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] ?? "";
		const [parsedFlag, inlineValue] = argument.split("=", 2);
		const flag = parsedFlag ?? argument;
		if (!["--base", "--compare", "--ref"].includes(flag)) {
			if (argument.startsWith("-")) throw new PrepArgumentError(`Unknown prep option: ${argument}`);
			positionals.push(argument);
		} else {
			const value = inlineValue ?? args[index + 1];
			if (!value || value.startsWith("--")) throw new PrepArgumentError(`${flag} needs a value`);
			if (inlineValue === undefined) index += 1;
			if (flag === "--base") baseRef = value;
			if (flag === "--compare") compareRef = value;
			if (flag === "--ref") mode = parseMode(value);
		}
	}
	return { positionals, baseRef, compareRef, mode };
};

const splitRange = (value: string): Pick<ScopeRequest, "baseRef" | "headRef" | "comparison"> => {
	const separator = value.includes("...") ? "..." : "..";
	const [baseRef, headRef, extra] = value.split(separator);
	if (!baseRef || !headRef || extra !== undefined) {
		throw new PrepArgumentError(`Invalid git range: ${value}`);
	}
	return {
		baseRef,
		headRef,
		comparison: separator === "..." ? RUN_COMPARISON.MERGE_BASE : RUN_COMPARISON.DIRECT,
	};
};

export function parseScopeRequest(args: string[]): ScopeRequest {
	const parsed = parseArguments(args);
	if (parsed.positionals.length > 2)
		throw new PrepArgumentError("prep accepts at most two git refs");
	if (parsed.positionals.length && (parsed.baseRef || parsed.compareRef)) {
		throw new PrepArgumentError("Use positional refs or --base/--compare, not both");
	}

	const firstPositional = parsed.positionals[0];
	const positionalRange =
		parsed.positionals.length === 1 && Boolean(firstPositional?.includes(".."));
	const explicitRefs =
		parsed.positionals.length > 0 || Boolean(parsed.baseRef || parsed.compareRef);
	const range = positionalRange && firstPositional ? splitRange(firstPositional) : undefined;
	const baseRef = range?.baseRef ?? parsed.positionals[0] ?? parsed.baseRef;
	const headRef = range?.headRef ?? parsed.positionals[1] ?? parsed.compareRef ?? "HEAD";
	const comparison = range?.comparison ?? RUN_COMPARISON.MERGE_BASE;
	if (parsed.mode !== "auto" && parsed.mode !== RUN_SCOPE_MODE.COMMITTED && headRef !== "HEAD") {
		throw new PrepArgumentError(
			"Working-tree modes compare the current checkout and cannot use a compare ref",
		);
	}
	return { mode: parsed.mode, comparison, baseRef, headRef, explicitRefs };
}
