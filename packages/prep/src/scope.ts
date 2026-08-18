import { RUN_COMPARISON, RUN_SCOPE_MODE, type RunIgnoreInputs, type RunScope } from "@revue/types";

export class PrepArgumentError extends Error {}

export type PullRequestScope = {
	/** Remote name or repository URL to fetch from. */
	source: string;
	/** The remote ref holding the pull request head, e.g. pull/123/head. */
	ref: string;
	/** Human-readable head label recorded in the run manifest. */
	label: string;
};

/** How the new run's lineage to an earlier narrated run is chosen. */
export type CarryRequest =
	| { kind: "auto" }
	| { kind: "none" }
	| { kind: "explicit"; runId: string };

export type ScopeRequest = {
	mode: RunScope["mode"] | "auto";
	comparison: typeof RUN_COMPARISON.DIRECT | typeof RUN_COMPARISON.MERGE_BASE;
	baseRef?: string;
	headRef: string;
	pullRequest?: PullRequestScope;
	explicitRefs: boolean;
	ignorePatterns: string[];
	carry: CarryRequest;
};

type ParsedArguments = {
	positionals: string[];
	baseRef?: string;
	compareRef?: string;
	pullRequest?: PullRequestScope;
	mode: ScopeRequest["mode"];
	ignorePatterns: string[];
	carryFrom?: string;
	noCarry: boolean;
};

const RUN_ID_PATTERN = /^[0-9a-f]{64}$/;

const parseCarryFrom = (value: string): string => {
	if (!RUN_ID_PATTERN.test(value)) {
		throw new PrepArgumentError(
			`--carry-from needs a full run id, received ${JSON.stringify(value)}`,
		);
	}
	return value;
};

const carryFor = (parsed: ParsedArguments): CarryRequest => {
	if (parsed.carryFrom && parsed.noCarry) {
		throw new PrepArgumentError("Use --carry-from or --no-carry, not both");
	}
	if (parsed.noCarry) return { kind: "none" };
	if (parsed.carryFrom) return { kind: "explicit", runId: parsed.carryFrom };
	return { kind: "auto" };
};

const parsePullRequest = (value: string): PullRequestScope => {
	if (/^\d+$/.test(value)) {
		return { source: "origin", ref: `pull/${value}/head`, label: `pull/${value}/head` };
	}
	const url = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/pull\/(\d+)(?:[/?#].*)?$/.exec(
		value,
	);
	if (!url?.[1] || !url[2] || !url[3]) {
		throw new PrepArgumentError(
			`--pr accepts a pull request number or a GitHub pull request URL, received ${JSON.stringify(value)}`,
		);
	}
	return {
		source: `https://github.com/${url[1]}/${url[2]}`,
		ref: `pull/${url[3]}/head`,
		label: `${url[1]}/${url[2]}#${url[3]}`,
	};
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
	let pullRequest: PullRequestScope | undefined;
	let mode: ScopeRequest["mode"] = "auto";
	const ignorePatterns: string[] = [];
	let carryFrom: string | undefined;
	let noCarry = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] ?? "";
		const [parsedFlag, inlineValue] = argument.split("=", 2);
		const flag = parsedFlag ?? argument;
		if (flag === "--no-carry") {
			noCarry = true;
		} else if (
			!["--base", "--compare", "--ref", "--ignore", "--pr", "--carry-from"].includes(flag)
		) {
			if (argument.startsWith("-")) throw new PrepArgumentError(`Unknown prep option: ${argument}`);
			positionals.push(argument);
		} else {
			const value = inlineValue ?? args[index + 1];
			if (!value || value.startsWith("--")) throw new PrepArgumentError(`${flag} needs a value`);
			if (inlineValue === undefined) index += 1;
			if (flag === "--base") baseRef = value;
			if (flag === "--compare") compareRef = value;
			if (flag === "--pr") pullRequest = parsePullRequest(value);
			if (flag === "--ref") mode = parseMode(value);
			if (flag === "--carry-from") carryFrom = parseCarryFrom(value);
			if (flag === "--ignore") {
				if (/[\r\n]/.test(value)) {
					throw new PrepArgumentError("--ignore accepts one pattern per option");
				}
				ignorePatterns.push(value);
			}
		}
	}
	return {
		positionals,
		baseRef,
		compareRef,
		pullRequest,
		mode,
		ignorePatterns,
		carryFrom,
		noCarry,
	};
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
	if (parsed.pullRequest) {
		if (parsed.positionals.length || parsed.compareRef) {
			throw new PrepArgumentError("--pr chooses the compare ref; pass only --base alongside it");
		}
		if (parsed.mode !== "auto" && parsed.mode !== RUN_SCOPE_MODE.COMMITTED) {
			throw new PrepArgumentError("--pr reviews committed history and cannot use a --ref mode");
		}
		return {
			mode: RUN_SCOPE_MODE.COMMITTED,
			comparison: RUN_COMPARISON.MERGE_BASE,
			baseRef: parsed.baseRef,
			headRef: parsed.pullRequest.label,
			pullRequest: parsed.pullRequest,
			explicitRefs: true,
			ignorePatterns: parsed.ignorePatterns,
			carry: carryFor(parsed),
		};
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
	return {
		mode: parsed.mode,
		comparison,
		baseRef,
		headRef,
		explicitRefs,
		ignorePatterns: parsed.ignorePatterns,
		carry: carryFor(parsed),
	};
}

// Matches the two label shapes parsePullRequest records as a --pr run's head.ref: neither is a
// ref that git can resolve on its own, so a run recorded with one of these cannot be re-prepped.
const PR_HEAD_LABEL_PATTERNS = [/^pull\/\d+\/head$/, /^[^/]+\/[^/]+#\d+$/];

/** The prep arguments that reproduce a recorded scope, or null when the scope cannot round-trip (a --pr run). */
export function rerunArgsFor(scope: RunScope, ignore?: RunIgnoreInputs): string[] | null {
	if (
		scope.mode === RUN_SCOPE_MODE.COMMITTED &&
		PR_HEAD_LABEL_PATTERNS.some((pattern) => pattern.test(scope.head.ref))
	) {
		return null;
	}
	const ignoreArgs = (ignore?.session ?? []).flatMap((pattern) => ["--ignore", pattern]);
	if (scope.mode !== RUN_SCOPE_MODE.COMMITTED) {
		return ["--ref", scope.mode, "--base", scope.base.ref, ...ignoreArgs];
	}
	if (scope.comparison === RUN_COMPARISON.DIRECT) {
		return [`${scope.base.ref}..${scope.head.ref}`, ...ignoreArgs];
	}
	return ["--base", scope.base.ref, "--compare", scope.head.ref, ...ignoreArgs];
}
