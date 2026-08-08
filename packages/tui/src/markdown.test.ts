import { expect, test } from "bun:test";
import { diagramKind, parseBlocks, parseInline, splitNarration } from "./markdown.tsx";

test("plain narration stays a single unstyled run", () => {
	expect(parseInline("The old path re-exports everything.")).toEqual([
		{ text: "The old path re-exports everything." },
	]);
});

test("bold, code and italic markers become styled runs", () => {
	expect(parseInline("split at the **last** colon")).toEqual([
		{ text: "split at the " },
		{ text: "last", style: "bold" },
		{ text: " colon" },
	]);
	expect(parseInline("`identifierSchema` moves out")).toEqual([
		{ text: "identifierSchema", style: "code" },
		{ text: " moves out" },
	]);
	expect(parseInline("a *deliberate* deviation")).toEqual([
		{ text: "a " },
		{ text: "deliberate", style: "italic" },
		{ text: " deviation" },
	]);
});

test("code runs keep their contents literal", () => {
	expect(parseInline('`"system|value"` and `urn:<vendor>:<field>`')).toEqual([
		{ text: '"system|value"', style: "code" },
		{ text: " and " },
		{ text: "urn:<vendor>:<field>", style: "code" },
	]);
});

test("unpaired and identifier markers are left alone", () => {
	expect(parseInline("MAX_RETRIES * 2 is unmatched")).toEqual([
		{ text: "MAX_RETRIES * 2 is unmatched" },
	]);
	expect(parseInline("a **bold start with no end")).toEqual([
		{ text: "a **bold start with no end" },
	]);
});

test("a fenced block is a block of its own, keeping its lines verbatim", () => {
	expect(parseBlocks("Run it:\n```sh\nrevue show run\n```\nthen read.")).toEqual([
		{ type: "prose", text: "Run it:" },
		{ type: "code", info: "sh", lines: ["revue show run"] },
		{ type: "prose", text: "then read." },
	]);
	// Inline markers inside a fence stay literal: a fence is code, not prose.
	expect(parseBlocks("```\na **b** c\n```")).toEqual([
		{ type: "code", info: "", lines: ["a **b** c"] },
	]);
});

test("an unclosed fence stays literal prose, as an unpaired inline marker does", () => {
	expect(parseBlocks("Run it:\n```sh\nrevue show run")).toEqual([
		{ type: "prose", text: "Run it:\n```sh\nrevue show run" },
	]);
});

test("nothing else in Markdown is a block: lists, tables and quotes are prose", () => {
	const text = "- one\n- two\n\n| a | b |\n| - | - |\n\n> quoted\n\n# heading";
	expect(parseBlocks(text)).toEqual([{ type: "prose", text }]);
});

test("a fence's info string decides whether it is a figure or a snippet", () => {
	expect(diagramKind("ascii")).toBe("ascii");
	expect(diagramKind("Mermaid")).toBe("mermaid");
	expect(diagramKind("ts")).toBeNull();
	expect(diagramKind("")).toBeNull();
});

test("diagrams leave the narration; every other fence stays in it", () => {
	const split = splitNarration(
		"Prep freezes the run.\n\n```ascii\nprep --> show\n```\n\nRun it:\n\n```sh\nrevue show run\n```",
	);

	expect(split.diagrams).toEqual([{ kind: "ascii", lines: ["prep --> show"] }]);
	expect(split.prose).toBe("Prep freezes the run.\n\nRun it:\n\n```sh\nrevue show run\n```");
	// Narration with no figure is handed on untouched.
	expect(splitNarration("Just prose.")).toEqual({ prose: "Just prose.", diagrams: [] });
});
