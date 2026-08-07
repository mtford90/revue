import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type SourceFile = {
	path: string;
	language: "ts" | "py" | "json" | "css";
	before: string;
	after: string;
};

export type SourceWorkload = {
	files: SourceFile[];
	additions: number;
	deletions: number;
	bytes: number;
	digest: string;
};

export type ScenarioExpectation =
	| {
			kind: "formatted";
			ansi: true;
			fileCount: number;
			additions: number;
			deletions: number;
			files: { path: string; additions: number; deletions: number }[];
	  }
	| { kind: "passthrough"; output: string; ansi: false }
	| { kind: "help"; contains: string[] };

export type Scenario = {
	id: string;
	description: string;
	args: string[];
	input: string;
	expect: ScenarioExpectation;
	source: SourceWorkload;
};

export type FormattedScenario = Scenario & {
	expect: Extract<ScenarioExpectation, { kind: "formatted" }>;
};

type Operation = { kind: "context" | "addition" | "deletion"; line: string };

const sha256 = (value: string): string => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(value);
	return `sha256:${hasher.digest("hex")}`;
};

const lines = (value: string): string[] => {
	const split = value.split("\n");
	if (split.at(-1) === "") split.pop();
	return split;
};

/** A deterministic full-file LCS diff. Full hunks intentionally exercise unchanged and changed rows. */
const diffLines = (before: string, after: string): Operation[] => {
	const oldLines = lines(before);
	const newLines = lines(after);
	const lengths = Array.from({ length: oldLines.length + 1 }, () =>
		Array<number>(newLines.length + 1).fill(0),
	);
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		const row = lengths[oldIndex];
		if (!row) throw new Error("diff matrix row is missing");
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			row[newIndex] =
				oldLines[oldIndex] === newLines[newIndex]
					? 1 + (lengths[oldIndex + 1]?.[newIndex + 1] ?? 0)
					: Math.max(
							lengths[oldIndex + 1]?.[newIndex] ?? 0,
							lengths[oldIndex]?.[newIndex + 1] ?? 0,
						);
		}
	}
	const operations: Operation[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (oldLines[oldIndex] === newLines[newIndex]) {
			operations.push({ kind: "context", line: oldLines[oldIndex] ?? "" });
			oldIndex += 1;
			newIndex += 1;
		} else if (
			newIndex < newLines.length &&
			(oldIndex >= oldLines.length ||
				(lengths[oldIndex]?.[newIndex + 1] ?? 0) > (lengths[oldIndex + 1]?.[newIndex] ?? 0))
		) {
			operations.push({ kind: "addition", line: newLines[newIndex] ?? "" });
			newIndex += 1;
		} else {
			operations.push({ kind: "deletion", line: oldLines[oldIndex] ?? "" });
			oldIndex += 1;
		}
	}
	return operations;
};

const patchForFile = (
	file: SourceFile,
): { patch: string; additions: number; deletions: number } => {
	const operations = diffLines(file.before, file.after);
	const additions = operations.filter((operation) => operation.kind === "addition").length;
	const deletions = operations.filter((operation) => operation.kind === "deletion").length;
	return {
		patch: `${[
			`diff --git a/${file.path} b/${file.path}`,
			`--- a/${file.path}`,
			`+++ b/${file.path}`,
			`@@ -1,${lines(file.before).length} +1,${lines(file.after).length} @@`,
			...operations.map((operation) => {
				const prefix =
					operation.kind === "context" ? " " : operation.kind === "addition" ? "+" : "-";
				return `${prefix}${operation.line}`;
			}),
		].join("\n")}\n`,
		additions,
		deletions,
	};
};

const sourceLine = (
	language: SourceFile["language"],
	index: number,
	value: number,
	padded: boolean,
): string => {
	const padding = padded ? ` ${"payload-".repeat(10)}${index}` : "";
	if (language === "py") return `value_${index} = ${value}  # benchmark${padding}`;
	if (language === "json") return `  "entry${index}": "value-${value}${padding}"`;
	if (language === "css")
		return `.rule-${index} { color: #${(value * 7919).toString(16).padStart(6, "0").slice(-6)}; /* benchmark${padding} */ }`;
	return `export const value${index}: number = ${value}; // benchmark${padding}`;
};

const sourceFile = (
	pathWithoutExtension: string,
	language: SourceFile["language"],
	lineCount: number,
	padded = false,
): SourceFile => {
	const extension = language;
	type RecordValue = { index: number; value: number };
	const beforeRecords: RecordValue[] = Array.from({ length: lineCount }, (_, index) => ({
		index: index + 1,
		value: index + 1,
	}));
	const afterRecords = beforeRecords.flatMap((record, index) => {
		if (index === 1) return [];
		if (index > 0 && index % 4 === 0) return [{ ...record, value: index + 101 }];
		return [record];
	});
	afterRecords.splice(Math.max(1, afterRecords.length - 1), 0, {
		index: lineCount + 1,
		value: lineCount + 201,
	});
	const render = (records: RecordValue[]) => {
		const body = records.map((record) => sourceLine(language, record.index, record.value, padded));
		if (language !== "json") return `${body.join("\n")}\n`;
		return `{\n${body.map((line, index) => `${line}${index < body.length - 1 ? "," : ""}`).join("\n")}\n}\n`;
	};
	return {
		path: `${pathWithoutExtension}.${extension}`,
		language,
		before: render(beforeRecords),
		after: render(afterRecords),
	};
};

const formattedScenario = ({
	id,
	description,
	args,
	files,
}: {
	id: string;
	description: string;
	args: string[];
	files: SourceFile[];
}): FormattedScenario => {
	const generated = files.map(patchForFile);
	const input = generated.map((item) => item.patch).join("");
	const additions = generated.reduce((sum, item) => sum + item.additions, 0);
	const deletions = generated.reduce((sum, item) => sum + item.deletions, 0);
	const sourceIdentity = files
		.map((file) => `${file.path}\0${file.before}\0${file.after}\0`)
		.join("");
	const source = {
		files,
		additions,
		deletions,
		bytes: Buffer.byteLength(sourceIdentity),
		digest: sha256(sourceIdentity),
	};
	const expectedFiles = files.map((file, index) => {
		const stats = generated[index];
		if (!stats) throw new Error(`missing generated patch stats for ${file.path}`);
		return { path: file.path, additions: stats.additions, deletions: stats.deletions };
	});
	return {
		id,
		description,
		args,
		input,
		expect: {
			kind: "formatted",
			ansi: true,
			fileCount: files.length,
			additions,
			deletions,
			files: expectedFiles,
		},
		source,
	};
};

const emptySource = (): SourceWorkload => ({
	files: [],
	additions: 0,
	deletions: 0,
	bytes: 0,
	digest: sha256(""),
});

export const buildScenarios = (): Scenario[] => {
	const tinyFiles = [sourceFile("src/lazygit-selection", "ts", 12)];
	const mediumFiles = (
		["ts", "py", "json", "css", "ts", "py", "json", "css", "ts", "py"] as const
	).map((language, index) => sourceFile(`mixed/file-${index}`, language, 24));
	const largeFiles = Array.from({ length: 50 }, (_, index) =>
		sourceFile(
			`large/file-${index}`,
			(["ts", "py", "json", "css"] as const)[index % 4] ?? "ts",
			10,
			true,
		),
	);
	return [
		{
			id: "startup-help",
			description: "compiled executable help/startup",
			args: ["--help"],
			input: "",
			expect: { kind: "help", contains: ["Usage:", "revuediff [options] < diff.patch"] },
			source: emptySource(),
		},
		{
			id: "unsupported-passthrough",
			description: "sanitised unsupported stdin",
			args: ["--paging=never"],
			input: "\x1b[31mnot a supported diff\x1b[0m\n",
			expect: { kind: "passthrough", output: "not a supported diff\n", ansi: false },
			source: emptySource(),
		},
		formattedScenario({
			id: "tiny-lazygit",
			description: "tiny LazyGit-like TypeScript diff",
			args: ["--paging=never", "--width=100", "--no-config"],
			files: tinyFiles,
		}),
		formattedScenario({
			id: "medium-mixed",
			description: "ten-file mixed language diff",
			args: ["--paging=never", "--width=100", "--no-config"],
			files: mediumFiles,
		}),
		formattedScenario({
			id: "large-mixed",
			description: "fifty-file mixed language diff with long wrapping rows",
			args: ["--paging=never", "--width=120", "--no-config"],
			files: largeFiles,
		}),
		formattedScenario({
			id: "tiny-narrow-stacked",
			description: "narrow stacked TypeScript diff",
			args: ["--paging=never", "--width=60", "--no-config"],
			files: tinyFiles,
		}),
		formattedScenario({
			id: "tiny-wide-split",
			description: "wide split TypeScript diff",
			args: ["--paging=never", "--width=160", "--no-config"],
			files: tinyFiles,
		}),
	];
};

export const formattedScenarios = (scenarios: Scenario[]): FormattedScenario[] =>
	scenarios.filter(
		(scenario): scenario is FormattedScenario => scenario.expect.kind === "formatted",
	);

const runGit = async (cwd: string, args: string[]): Promise<void> => {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
};

export const writeSourceTree = async (
	directory: string,
	files: SourceFile[],
	side: "before" | "after",
): Promise<void> => {
	for (const file of files) {
		const path = join(directory, file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file[side]);
	}
};

/** Proves the generated patch applies to its pre-image and produces its declared post-image. */
export async function validateScenarioPatch(scenario: FormattedScenario): Promise<void> {
	await withTempDirectory(async (directory) => {
		await runGit(directory, ["init", "-q"]);
		await writeSourceTree(directory, scenario.source.files, "before");
		const patchPath = join(directory, "scenario.patch");
		await writeFile(patchPath, scenario.input);
		await runGit(directory, ["apply", "--check", "scenario.patch"]);
		await runGit(directory, ["apply", "scenario.patch"]);
		for (const file of scenario.source.files) {
			const actual = await readFile(join(directory, file.path), "utf8");
			if (actual !== file.after)
				throw new Error(`${scenario.id}: Git produced the wrong ${file.path}`);
		}
	});
}

export async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-perf-"));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
