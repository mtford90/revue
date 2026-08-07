import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Scenario = {
	id: string;
	description: string;
	args: string[];
	input: string;
	meaningfulBytes: number;
	expect: "formatted" | "passthrough" | "help";
};

const fileDiff = (
	path: string,
	language: "ts" | "py" | "json" | "css",
	lines: number,
	padded = false,
) => {
	const padding = padded ? "payload".repeat(26) : "x";
	const oldLines = Array.from({ length: lines }, (_, index) => {
		const n = index + 1;
		if (language === "py") return `value_${n} = ${n} # ${padding}`;
		if (language === "json") return `  "entry${n}": "${padding}",`;
		if (language === "css")
			return `.rule-${n} { color: #${(n * 7919).toString(16).padStart(6, "0").slice(-6)}; /* ${padding} */ }`;
		return `export const value${n}: number = ${n}; // ${padding}`;
	});
	const newLines = oldLines.map((line, index) =>
		index % 3 === 0
			? line.replace(/\d+;?$|\d+,?$/, `${index + 10}${line.endsWith(",") ? "," : ";"}`)
			: line,
	);
	const extension = language === "py" ? "py" : language;
	return [
		`diff --git a/${path}.${extension} b/${path}.${extension}`,
		"index 1111111..2222222 100644",
		`--- a/${path}.${extension}`,
		`+++ b/${path}.${extension}`,
		`@@ -1,${lines} +1,${lines} @@`,
		...oldLines.flatMap((line, index) =>
			line === newLines[index] ? [` ${line}`] : [`-${line}`, `+${newLines[index]}`],
		),
		"",
	].join("\n");
};

export const buildScenarios = (): Scenario[] => {
	const tiny = fileDiff("src/lazygit-selection", "ts", 8);
	const medium = ["ts", "py", "json", "css", "ts", "py", "json", "css", "ts", "py"]
		.map((language, index) => fileDiff(`mixed/file-${index}`, language as "ts", 24))
		.join("");
	const large = Array.from({ length: 50 }, (_, index) =>
		fileDiff(`large/file-${index}`, (["ts", "py", "json", "css"] as const)[index % 4], 20, true),
	).join("");
	return [
		{
			id: "startup-help",
			description: "compiled executable help/startup",
			args: ["--help"],
			input: "",
			meaningfulBytes: 0,
			expect: "help",
		},
		{
			id: "unsupported-passthrough",
			description: "sanitised unsupported stdin",
			args: ["--paging=never"],
			input: "\x1b[31mnot a supported diff\x1b[0m\n",
			meaningfulBytes: 0,
			expect: "passthrough",
		},
		{
			id: "tiny-lazygit",
			description: "tiny LazyGit-like TypeScript diff",
			args: ["--paging=never", "--width=100", "--no-config"],
			input: tiny,
			meaningfulBytes: tiny.length,
			expect: "formatted",
		},
		{
			id: "medium-mixed",
			description: "ten-file mixed language diff",
			args: ["--paging=never", "--width=100", "--no-config"],
			input: medium,
			meaningfulBytes: medium.length,
			expect: "formatted",
		},
		{
			id: "large-mixed",
			description: "fifty-file mixed language diff",
			args: ["--paging=never", "--width=100", "--no-config"],
			input: large,
			meaningfulBytes: large.length,
			expect: "formatted",
		},
		{
			id: "tiny-narrow-stacked",
			description: "narrow stacked TypeScript diff",
			args: ["--paging=never", "--width=60", "--no-config"],
			input: tiny,
			meaningfulBytes: tiny.length,
			expect: "formatted",
		},
		{
			id: "tiny-wide-split",
			description: "wide split TypeScript diff",
			args: ["--paging=never", "--width=120", "--no-config"],
			input: tiny,
			meaningfulBytes: tiny.length,
			expect: "formatted",
		},
	];
};

export async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-perf-"));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
