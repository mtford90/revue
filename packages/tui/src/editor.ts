import { isAbsolute, relative, resolve } from "node:path";
import type { DiffLineRange } from "@revue/diff";

export type EditorOpenResult = { text: string; tone: "success" | "error" };

type EditorProcess = { exited: Promise<number> };
type SpawnEditor = (command: string[], options: { cwd: string }) => EditorProcess;

type EditorCommand = { variable: "VISUAL" | "EDITOR"; argv: string[] };

/**
 * Split the editor setting into argv without invoking a shell. Quotes and backslashes provide the
 * spacing people commonly need in VISUAL/EDITOR, while substitutions, redirects and separators
 * remain ordinary argument text and therefore cannot execute a second command.
 */
const splitEditorCommand = (value: string): string[] | null => {
	const argv: string[] = [];
	let token = "";
	let tokenStarted = false;
	let quote: "single" | "double" | null = null;
	let escaped = false;
	for (const character of value.trim()) {
		if (escaped) {
			token += character;
			tokenStarted = true;
			escaped = false;
			continue;
		}
		if (quote === "single") {
			if (character === "'") quote = null;
			else token += character;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			tokenStarted = true;
			continue;
		}
		if (quote === "double") {
			if (character === '"') quote = null;
			else token += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character === "'" ? "single" : "double";
			tokenStarted = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (tokenStarted) {
				argv.push(token);
				token = "";
				tokenStarted = false;
			}
			continue;
		}
		token += character;
		tokenStarted = true;
	}
	if (escaped || quote) return null;
	if (tokenStarted) argv.push(token);
	return argv.length && argv[0] ? argv : null;
};

const editorCommand = (environment: Record<string, string | undefined>): EditorCommand | null => {
	const variable = environment.VISUAL?.trim()
		? "VISUAL"
		: environment.EDITOR?.trim()
			? "EDITOR"
			: null;
	if (!variable) return null;
	const value = environment[variable];
	if (!value) return null;
	const argv = splitEditorCommand(value);
	return argv ? { variable, argv } : { variable, argv: [] };
};

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
	const editor = editorCommand(environment);
	if (!editor) return { text: "Set $VISUAL or $EDITOR to open review lines", tone: "error" };
	const executable = editor.argv[0];
	if (!executable) {
		return { text: `Could not parse $${editor.variable} as an editor command`, tone: "error" };
	}

	beforeOpen?.();
	try {
		const child = spawn([...editor.argv, `+${range.startLine}`, "--", target], {
			cwd: repositoryRoot,
		});
		const exitCode = await child.exited;
		return exitCode === 0
			? {
					text: `Returned from ${executable}: ${range.filePath}:${range.startLine}`,
					tone: "success",
				}
			: { text: `${executable} exited with status ${exitCode}`, tone: "error" };
	} catch (error) {
		return {
			text: `Could not open ${executable}: ${error instanceof Error ? error.message : String(error)}`,
			tone: "error",
		};
	} finally {
		afterOpen?.();
	}
};
