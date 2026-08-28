import { isAbsolute, relative, resolve } from "node:path";
import type { DiffLineRange } from "@revue/diff";

export type EditorOpenResult = { text: string; tone: "success" | "error" };

type EditorProcess = { exited: Promise<number> };
type SpawnEditor = (command: string[], options: { cwd: string }) => EditorProcess;

const editorExecutable = (environment: Record<string, string | undefined>): string | null =>
	environment.VISUAL?.trim() || environment.EDITOR?.trim() || null;

const reviewedPath = (repositoryRoot: string, filePath: string): string | null => {
	const target = resolve(repositoryRoot, filePath);
	const fromRoot = relative(repositoryRoot, target);
	return !isAbsolute(fromRoot) &&
		fromRoot !== ".." &&
		!fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
		? target
		: null;
};

/** Open one current-side source line, with terminal lifecycle kept at the caller's process boundary. */
export const openReviewLineInEditor = async ({
	range,
	repositoryRoot,
	environment = process.env,
	spawn = (command, options) =>
		Bun.spawn(command, {
			cwd: options.cwd,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		}),
	beforeOpen,
	afterOpen,
}: {
	range: DiffLineRange;
	repositoryRoot: string | null;
	environment?: Record<string, string | undefined>;
	spawn?: SpawnEditor;
	beforeOpen?: () => void;
	afterOpen?: () => void;
}): Promise<EditorOpenResult> => {
	if (range.side === "deletions") {
		return {
			text: "Cannot open a deleted-side line in the current worktree",
			tone: "error",
		};
	}
	if (!repositoryRoot) return { text: "Cannot locate the reviewed worktree", tone: "error" };
	const target = reviewedPath(repositoryRoot, range.filePath);
	if (!target)
		return { text: "Refusing to open a path outside the reviewed worktree", tone: "error" };
	const editor = editorExecutable(environment);
	if (!editor) return { text: "Set $VISUAL or $EDITOR to open review lines", tone: "error" };

	beforeOpen?.();
	try {
		const child = spawn([editor, `+${range.startLine}`, "--", target], { cwd: repositoryRoot });
		const exitCode = await child.exited;
		return exitCode === 0
			? { text: `Returned from ${editor}: ${range.filePath}:${range.startLine}`, tone: "success" }
			: { text: `${editor} exited with status ${exitCode}`, tone: "error" };
	} catch (error) {
		return {
			text: `Could not open ${editor}: ${error instanceof Error ? error.message : String(error)}`,
			tone: "error",
		};
	} finally {
		afterOpen?.();
	}
};
