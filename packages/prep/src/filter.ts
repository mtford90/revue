import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_EXCLUSION_REASON, type RunExclusion } from "@revue/types";
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

export type FilterRules = {
	builtIn: Ignore;
	revueIgnore: Ignore;
};

const matcher = (patterns: string[]): Ignore => {
	const rules = ignore();
	for (const pattern of patterns) rules.add({ pattern, mark: pattern });
	return rules;
};

const revueIgnorePatterns = async (root: string): Promise<string[]> => {
	try {
		return (await readFile(join(root, ".revueignore"), "utf8"))
			.split("\n")
			.map((line) => line.replace(/\r$/, ""))
			.filter((line) => line.trim() && !line.startsWith("#"));
	} catch (error) {
		if (Reflect.get(Object(error), "code") === "ENOENT") return [];
		throw error;
	}
};

export const loadFilterRules = async (root: string): Promise<FilterRules> => ({
	builtIn: matcher(BUILT_IN_PATTERNS),
	revueIgnore: matcher(await revueIgnorePatterns(root)),
});

const matchingPattern = (rules: Ignore, paths: string[]): string | undefined => {
	for (const path of paths) {
		const result = rules.test(path);
		if (result.ignored) return result.rule?.mark ?? result.rule?.pattern ?? path;
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
	const builtInPattern = specialPattern ?? matchingPattern(rules.builtIn, paths);
	if (builtInPattern) {
		return {
			path: input.path,
			reason: RUN_EXCLUSION_REASON.BUILT_IN,
			pattern: builtInPattern,
		};
	}
	const revuePattern = matchingPattern(rules.revueIgnore, paths);
	return revuePattern
		? { path: input.path, reason: RUN_EXCLUSION_REASON.REVUE_IGNORE, pattern: revuePattern }
		: undefined;
};
