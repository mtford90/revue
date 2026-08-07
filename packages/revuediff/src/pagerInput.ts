import { type DiffFile, parsePatch, sanitizeTerminalLine } from "@revue/diff";

export type PagerInput =
	| { kind: "supported"; files: DiffFile[]; preamble: string }
	| { kind: "passthrough"; text: string };

/** Preserve physical line boundaries while removing all terminal controls from untrusted input. */
export const sanitizePagerInput = (input: string): string =>
	input
		.split(/(\r?\n)/)
		.map((part) => (part === "\n" || part === "\r\n" ? part : sanitizeTerminalLine(part)))
		.join("");

const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const plainHeader = (line: string, next: string | undefined) =>
	line.startsWith("--- ") && next?.startsWith("+++ ");

/**
 * Classify only complete ordinary unified-diff envelopes. This intentionally errs toward direct
 * sanitized output: a pager must never lose prose or a patch section it does not understand.
 */
export function classifyPagerInput(input: string): PagerInput {
	const text = sanitizePagerInput(input);
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	if (/^(?:diff --cc |diff --combined |@@@)/m.test(text) || /^Submodule /m.test(text))
		return { kind: "passthrough", text };
	let first = -1;
	for (let index = 0; index < lines.length; index++) {
		if (
			lines[index]?.startsWith("diff --git ") ||
			plainHeader(lines[index] ?? "", lines[index + 1])
		) {
			first = index;
			break;
		}
	}
	if (first < 0) return { kind: "passthrough", text };
	const preambleLines = lines.slice(0, first);
	if (preambleLines.slice(1).some((line) => line.startsWith("commit ")))
		return { kind: "passthrough", text };
	const patch = lines.slice(first).join("\n");
	let oldRemaining = 0;
	let newRemaining = 0;
	let boundaries = 0;
	let gitEnvelope = false;
	let pendingPlainNewHeader = false;
	let currentFileComplete = false;
	let completedHunk = false;
	let mayHaveNoNewlineMarker = false;
	for (let index = first; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (oldRemaining > 0 || newRemaining > 0) {
			if (line.startsWith(" ")) {
				oldRemaining--;
				newRemaining--;
				mayHaveNoNewlineMarker = true;
			} else if (line.startsWith("-")) {
				oldRemaining--;
				mayHaveNoNewlineMarker = true;
			} else if (line.startsWith("+")) {
				newRemaining--;
				mayHaveNoNewlineMarker = true;
			} else if (line !== "\\ No newline at end of file") return { kind: "passthrough", text };
			if (oldRemaining === 0 && newRemaining === 0) {
				currentFileComplete = true;
				completedHunk = true;
			}
			continue;
		}
		if (line === "\\ No newline at end of file") {
			if (!mayHaveNoNewlineMarker) return { kind: "passthrough", text };
			continue;
		}
		mayHaveNoNewlineMarker = false;
		if (pendingPlainNewHeader) {
			if (!line.startsWith("+++ ")) return { kind: "passthrough", text };
			pendingPlainNewHeader = false;
			currentFileComplete = true;
			continue;
		}
		const match = hunk.exec(line);
		if (match) {
			oldRemaining = match[1] === undefined ? 1 : Number(match[1]);
			newRemaining = match[2] === undefined ? 1 : Number(match[2]);
			continue;
		}
		if (line.startsWith("diff --git ")) {
			if (boundaries > 0 && !currentFileComplete) return { kind: "passthrough", text };
			boundaries++;
			gitEnvelope = true;
			currentFileComplete = false;
			completedHunk = false;
			continue;
		}
		if (!gitEnvelope && plainHeader(line, lines[index + 1])) {
			boundaries++;
			pendingPlainNewHeader = true;
			currentFileComplete = false;
			completedHunk = false;
			continue;
		}
		if (line.startsWith("--- ")) {
			if (!gitEnvelope || pendingPlainNewHeader) return { kind: "passthrough", text };
			pendingPlainNewHeader = true;
			continue;
		}
		if (line.startsWith("+++ ")) return { kind: "passthrough", text };
		if (/^(?:commit |diff --cc |diff --combined |@@@|Submodule )/.test(line))
			return { kind: "passthrough", text };
		// A completed hunk cannot have trailing envelope records: parsePatch may otherwise ignore them.
		if (completedHunk && line) return { kind: "passthrough", text };
		// Ordinary Git file-envelope lines are understood; anything else after a complete file is not.
		if (
			!/^(?:index |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |Binary files |GIT binary patch|literal |delta |$)/.test(
				line,
			)
		)
			return { kind: "passthrough", text };
		if (
			line.startsWith("Binary files ") ||
			line === "GIT binary patch" ||
			/^(?:old mode |new mode |rename to |deleted file mode |new file mode )/.test(line)
		)
			currentFileComplete = true;
	}
	if (oldRemaining !== 0 || newRemaining !== 0 || pendingPlainNewHeader || !currentFileComplete)
		return { kind: "passthrough", text };
	try {
		const files = parsePatch(patch, "pager");
		if (!files.length || files.length !== boundaries) return { kind: "passthrough", text };
		return { kind: "supported", files, preamble: preambleLines.join("\n").replace(/\n+$/, "") };
	} catch {
		return { kind: "passthrough", text };
	}
}
