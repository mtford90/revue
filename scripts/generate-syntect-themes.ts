#!/usr/bin/env bun
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
// The generator deliberately resolves Shiki through the Patch engine's declared dependency.
import { bundledThemes } from "../packages/diff/node_modules/shiki";
import { compositeTerminalForeground } from "../packages/diff/src/syntectTheme.ts";
import { BUNDLED_SHIKI_THEME_IDS } from "../packages/theme/src/shikiThemes.ts";

type ThemeRule = {
	scope?: string | string[];
	settings?: { foreground?: string; fontStyle?: string };
};
type ShikiTheme = { name: string; colors?: Record<string, string>; tokenColors?: ThemeRule[] };
const output = join(import.meta.dir, "../packages/diff/native/themes");
const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const themeXml = (theme: ShikiTheme): string => {
	const background = theme.colors?.["editor.background"] ?? theme.colors?.background ?? "#000000";
	const rules = (theme.tokenColors ?? []).flatMap((rule) => {
		const foreground = rule.settings?.foreground
			? compositeTerminalForeground(rule.settings.foreground, background)
			: undefined;
		const scopes = rule.scope ? (Array.isArray(rule.scope) ? rule.scope : [rule.scope]) : [];
		if (!foreground || scopes.length === 0) return [];
		return [
			`<dict><key>scope</key><string>${escapeXml(scopes.join(", "))}</string><key>settings</key><dict><key>foreground</key><string>${foreground}</string>${rule.settings?.fontStyle ? `<key>fontStyle</key><string>${escapeXml(rule.settings.fontStyle)}</string>` : ""}</dict></dict>`,
		];
	});
	const foreground = theme.colors?.["editor.foreground"] ?? theme.colors?.foreground;
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>name</key><string>${escapeXml(theme.name)}</string><key>settings</key><array><dict><key>settings</key><dict>${foreground ? `<key>foreground</key><string>${compositeTerminalForeground(foreground, background) ?? foreground}</string>` : ""}<key>background</key><string>${background.slice(0, 7)}</string></dict></dict>${rules.join("")}</array></dict></plist>\n`;
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const id of BUNDLED_SHIKI_THEME_IDS) {
	const registration = bundledThemes[id];
	if (!registration) throw new Error(`Shiki does not expose bundled theme ${id}`);
	const imported = await registration();
	const theme = ("default" in imported ? imported.default : imported) as ShikiTheme;
	await writeFile(join(output, `${id}.tmTheme`), themeXml(theme));
}
console.log(`Converted ${BUNDLED_SHIKI_THEME_IDS.length} bundled Shiki themes to Syntect assets.`);
