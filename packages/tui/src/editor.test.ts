import { expect, test } from "bun:test";
import { openReviewLineInEditor } from "./editor.ts";

const range = (side: "additions" | "deletions" = "additions") => ({
	filePath: "src/value.ts",
	hunkOldStart: 4,
	side,
	startLine: 7,
	endLine: 9,
});

test("editor opening uses VISUAL, the reviewed root, and the range's first line", async () => {
	const commands: string[][] = [];
	const lifecycle: string[] = [];
	const result = await openReviewLineInEditor({
		range: range(),
		repositoryRoot: "/reviewed/worktree",
		environment: { VISUAL: "nvim", EDITOR: "vim" },
		spawn: (command, options) => {
			commands.push([...command, `cwd=${options.cwd}`]);
			return { exited: Promise.resolve(0) };
		},
		beforeOpen: () => lifecycle.push("suspend"),
		afterOpen: () => lifecycle.push("resume"),
	});

	expect(commands).toEqual([
		["nvim", "+7", "--", "/reviewed/worktree/src/value.ts", "cwd=/reviewed/worktree"],
	]);
	expect(lifecycle).toEqual(["suspend", "resume"]);
	expect(result.tone).toBe("success");
});

test("deleted-side lines refuse before any process or terminal transition", async () => {
	let spawned = false;
	let suspended = false;
	const result = await openReviewLineInEditor({
		range: range("deletions"),
		repositoryRoot: "/reviewed/worktree",
		environment: { EDITOR: "nvim" },
		spawn: () => {
			spawned = true;
			return { exited: Promise.resolve(0) };
		},
		beforeOpen: () => {
			suspended = true;
		},
	});

	expect(result).toEqual({
		text: "Cannot open a deleted-side line in the current worktree",
		tone: "error",
	});
	expect(spawned).toBe(false);
	expect(suspended).toBe(false);
});
