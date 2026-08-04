import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPreferencesPath, loadPreferences, savePreferences } from "./preferences.ts";

const tmpDirs: string[] = [];
afterAll(async () => {
	await Promise.all(tmpDirs.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("reviewer preferences live in the user's home rather than one review repository", () => {
	expect(defaultPreferencesPath()).toBe(join(homedir(), ".revue", "preferences.json"));
});

test("reviewer preferences round-trip theme, layout, and view choices", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-preferences-"));
	tmpDirs.push(directory);
	const path = join(directory, "preferences.json");
	const preferences = {
		themeId: "ayu-dark",
		indexExpanded: false,
		sidebarPreference: "hidden" as const,
		diffPreference: "stacked" as const,
		fileDisplay: "focused" as const,
		pathDisplay: "tree" as const,
		viewMode: "semantic" as const,
		panelWidth: 42,
	};

	savePreferences(path, preferences);

	expect(await loadPreferences(path)).toEqual(preferences);
});
