import { expect, test } from "bun:test";
import { parseInline } from "./markdown.tsx";

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
