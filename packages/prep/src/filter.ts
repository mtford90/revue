import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_EXCLUSION_REASON, type RunExclusion, type RunIgnoreInputs } from "@revue/types";
import ignore, { type Ignore } from "ignore";

const BUILT_IN_PATTERNS = [
	"bun.lock",
	"bun.lockb",
	"Cargo.lock",
	"composer.lock",
	"Gemfile.lock",
	"npm-shrinkwrap.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"poetry.lock",
	"uv.lock",
	"yarn.lock",
	"*.min.css",
	"*.min.js",
	"*.map",
];

type ReviewIgnoreReason =
	| typeof RUN_EXCLUSION_REASON.REVUE_IGNORE
	| typeof RUN_EXCLUSION_REASON.SESSION_IGNORE;

type MarkedPattern = {
	pattern: string;
	reason: ReviewIgnoreReason;
};

export type FilterRules = {
	builtIn: Ignore;
	review: Ignore;
	markedPatterns: ReadonlyMap<string, MarkedPattern>;
	inputs: RunIgnoreInputs;
};

const matcher = (patterns: string[]): Ignore => {
	const rules = ignore();
	for (const pattern of patterns) rules.add({ pattern, mark: pattern });
	return rules;
};

const effectivePatternLines = (content: string): string[] =>
	content
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter((line) => line.trim().length > 0 && !line.startsWith("#"));

const revueIgnorePatterns = async (root: string): Promise<string[]> => {
	try {
		return effectivePatternLines(await readFile(join(root, ".revueignore"), "utf8"));
	} catch (error) {
		if (Reflect.get(Object(error), "code") === "ENOENT") return [];
		throw error;
	}
};

const reviewMatcher = (inputs: RunIgnoreInputs): Pick<FilterRules, "review" | "markedPatterns"> => {
	const review = ignore();
	const markedPatterns = new Map<string, MarkedPattern>();
	const add = (patterns: string[], reason: ReviewIgnoreReason): void => {
		for (const [index, pattern] of patterns.entries()) {
			const mark = `${reason}:${index}`;
			markedPatterns.set(mark, { pattern, reason });
			review.add({ pattern, mark });
		}
	};
	add(inputs.revueIgnore, RUN_EXCLUSION_REASON.REVUE_IGNORE);
	add(inputs.session, RUN_EXCLUSION_REASON.SESSION_IGNORE);
	return { review, markedPatterns };
};

export const loadFilterRules = async (
	root: string,
	sessionPatterns: string[] = [],
): Promise<FilterRules> => {
	const inputs = {
		revueIgnore: await revueIgnorePatterns(root),
		session: effectivePatternLines(sessionPatterns.join("\n")),
	};
	return {
		builtIn: matcher(BUILT_IN_PATTERNS),
		...reviewMatcher(inputs),
		inputs,
	};
};

type Match = {
	matchedPath: string;
	pattern: string;
};

const matchingPattern = (rules: Ignore, paths: string[]): Match | undefined => {
	for (const path of paths) {
		const result = rules.test(path);
		if (result.ignored) {
			return {
				matchedPath: path,
				pattern: result.rule?.mark ?? result.rule?.pattern ?? path,
			};
		}
	}
	return undefined;
};

export type ExclusionInput = {
	path: string;
	previousPath?: string;
	isBinary: boolean;
	isGitlink: boolean;
};

export const exclusionFor = (
	input: ExclusionInput,
	rules: FilterRules,
): RunExclusion | undefined => {
	const paths = [input.path, input.previousPath].filter((path): path is string => Boolean(path));
	const specialPattern = input.isGitlink ? "<submodule>" : input.isBinary ? "<binary>" : undefined;
	const builtInMatch = specialPattern
		? { matchedPath: input.path, pattern: specialPattern }
		: matchingPattern(rules.builtIn, paths);
	if (builtInMatch) {
		return {
			path: input.path,
			matchedPath: builtInMatch.matchedPath,
			reason: RUN_EXCLUSION_REASON.BUILT_IN,
			pattern: builtInMatch.pattern,
		};
	}
	const reviewMatch = matchingPattern(rules.review, paths);
	if (!reviewMatch) return undefined;
	const marked = rules.markedPatterns.get(reviewMatch.pattern);
	if (!marked) throw new Error(`Missing review ignore provenance for ${reviewMatch.pattern}`);
	return {
		path: input.path,
		matchedPath: reviewMatch.matchedPath,
		reason: marked.reason,
		pattern: marked.pattern,
	};
};
