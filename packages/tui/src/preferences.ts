import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

// Preferences belong to the reviewer, not to one run, so they live beside review progress
// rather than inside the `{ [runKey]: ViewState }` map that `state.json` holds.
const PreferencesSchema = z.object({
	themeId: z.string().optional(),
	transparentBackground: z.boolean().optional(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const defaultPreferencesPath = (): string =>
	join(process.cwd(), ".revue", "preferences.json");

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
