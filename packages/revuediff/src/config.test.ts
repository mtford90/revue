import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CONFIG,
	discoverConfigPath,
	effectiveConfig,
	initConfig,
	parseConfig,
	STARTER_CONFIG,
} from "./config.ts";

test("discovers XDG and environment paths with CLI and disable precedence", () => {
	const env = { XDG_CONFIG_HOME: "/xdg", REVUEDIFF_CONFIG: "/env/config.toml" };
	expect(discoverConfigPath({ env })).toEqual({
		path: "/env/config.toml",
		explicit: "environment",
	});
	expect(discoverConfigPath({ env, cliPath: "/cli/config.toml" })).toEqual({
		path: "/cli/config.toml",
		explicit: "cli",
	});
	expect(discoverConfigPath({ env, disabled: true })).toEqual({ explicit: "disabled" });
	expect(discoverConfigPath({ env: { XDG_CONFIG_HOME: "/xdg" } }).path).toBe(
		"/xdg/revuediff/config.toml",
	);
});

test("validates keys independently and surfaces unknown structure", () => {
	const result = parseConfig(`[display]
line-numbers = true
change-markers = "yes"
theme = "not-real"
extra = 1
[paging]
mode = "never"
other = true
[unknown]
value = 1
`);
	expect(result.values).toEqual({ lineNumbers: true, paging: "never" });
	expect(result.warnings).toHaveLength(5);
	expect(result.warnings.join("\n")).toContain("display.change-markers");
	expect(result.warnings.join("\n")).toContain("unknown key unknown");
});

test("malformed TOML safely falls back without throwing", () => {
	const result = parseConfig("[display\nline-numbers = true");
	expect(result.values).toEqual({});
	expect(result.warnings[0]).toContain("malformed TOML");
});

test("built-ins are overridden per key by config then CLI", () => {
	const result = effectiveConfig(
		{ lineNumbers: true, theme: "github-light", paging: "never" },
		{ lineNumbers: false, changeMarkers: true },
	);
	expect(result).toMatchObject({
		...DEFAULT_CONFIG,
		lineNumbers: false,
		changeMarkers: true,
		theme: "github-light",
		paging: "never",
		sources: {
			lineNumbers: "cli",
			changeMarkers: "cli",
			theme: "config",
			paging: "config",
		},
	});
});

test("starter configuration documents auto theme as the safe dark fallback", () => {
	expect(STARTER_CONFIG).toContain('"auto" for the safe dark fallback');
	expect(STARTER_CONFIG).not.toContain("terminal light/dark detection");
});

test("config init creates parents and requires force to overwrite", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revuediff-config-"));
	const path = join(directory, "nested", "config.toml");
	try {
		await initConfig(path, false);
		expect(await readFile(path, "utf8")).toContain("line-numbers = false");
		await expect(initConfig(path, false)).rejects.toThrow("--force");
		await initConfig(path, true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
