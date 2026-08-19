import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { PATH_DISPLAY_MODES } from "./pathDisplay.ts";

export type FileDisplayPreference = "all" | "focused";

const PreferencesSchema = z.object({
	/** A pinned theme id, or `auto` to follow the terminal using the light/dark pair below. */
	themeId: z.string().optional(),
	lightThemeId: z.string().optional(),
	darkThemeId: z.string().optional(),
	transparentBackground: z.boolean().optional(),
	indexExpanded: z.boolean().optional(),
	sidebarPreference: z.enum(["auto", "shown", "hidden"]).optional(),
	diffPreference: z.enum(["auto", "split", "stacked"]).optional(),
	lineNumbers: z.boolean().optional(),
	changeMarkers: z.boolean().optional(),
	fileDisplay: z.enum(["all", "focused"]).optional(),
	pathDisplay: z.enum(PATH_DISPLAY_MODES).optional(),
	panelWidth: z.number().int().positive().optional(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const defaultPreferencesPath = (): string => join(homedir(), ".revue", "preferences.json");

export async function loadPreferences(path: string): Promise<Preferences> {
	try {
		const parsed = PreferencesSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

/** Persist a preference change, leaving unrelated keys intact. Failures are not fatal. */
export function savePreferences(path: string, next: Preferences): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	} catch {
		// A read-only checkout still reviews; it just forgets the choice.
	}
}
