import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_EXCLUSION_REASON } from "@revue/types";
import { exclusionFor, loadFilterRules } from "../src/filter.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const exclusion = (
	path: string,
	rules: Awaited<ReturnType<typeof loadFilterRules>>,
	previousPath?: string,
) => exclusionFor({ path, previousPath, isBinary: false, isGitlink: false }, rules);

test("built-in rules exclude the .revue state directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-ignore-"));
	roots.push(root);
	const rules = await loadFilterRules(root);

	expect(exclusion(".revue/state.json", rules)).toMatchObject({
		reason: RUN_EXCLUSION_REASON.BUILT_IN,
		pattern: ".revue/",
	});
	expect(exclusion(".revue/runs/abc/artifact.json", rules)).toMatchObject({
		reason: RUN_EXCLUSION_REASON.BUILT_IN,
		pattern: ".revue/",
	});
	expect(exclusion("src/.revue.ts", rules)).toBeUndefined();
});

test("built-in rules exclude common lockfiles and minified assets", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-ignore-"));
	roots.push(root);
	const rules = await loadFilterRules(root);

	const excluded = [
		".terraform.lock.hcl",
		"Cartfile.resolved",
		"Chart.lock",
		"deno.lock",
		"flake.lock",
		"android/gradle.lockfile",
		"mix.lock",
		"ios/Podfile.lock",
		"Package.resolved",
		"packages.lock.json",
		"pdm.lock",
		"Pipfile.lock",
		"pubspec.lock",
		"renv.lock",
		"dist/app.min.mjs",
	];
	for (const path of excluded) {
		expect(exclusion(path, rules)).toMatchObject({ reason: RUN_EXCLUSION_REASON.BUILT_IN });
	}
	expect(exclusion("go.sum", rules)).toBeUndefined();
});

test("review ignores preserve gitignore semantics and append session rules", async () => {
	const root = await mkdtemp(join(tmpdir(), "revue-ignore-"));
	roots.push(root);
	await writeFile(
		join(root, ".revueignore"),
		[
			"# persistent review rules",
			"/root-only.ts",
			"fixtures/",
			"\\#literal.ts",
			"*.generated.ts",
			"old-name.ts",
			"",
		].join("\n"),
	);
	const rules = await loadFilterRules(root, [
		"!src/keep.generated.ts",
		"!fixtures/keep.ts",
		"!old-name.ts",
		"session/**",
	]);

	expect(rules.inputs).toEqual({
		revueIgnore: ["/root-only.ts", "fixtures/", "\\#literal.ts", "*.generated.ts", "old-name.ts"],
		session: ["!src/keep.generated.ts", "!fixtures/keep.ts", "!old-name.ts", "session/**"],
	});
	expect(exclusion("root-only.ts", rules)).toMatchObject({
		reason: RUN_EXCLUSION_REASON.REVUE_IGNORE,
		pattern: "/root-only.ts",
	});
	expect(exclusion("nested/root-only.ts", rules)).toBeUndefined();
	expect(exclusion("fixtures/deep/value.ts", rules)).toMatchObject({
		pattern: "fixtures/",
	});
	expect(exclusion("fixtures/keep.ts", rules)).toMatchObject({ pattern: "fixtures/" });
	expect(exclusion("#literal.ts", rules)).toMatchObject({ pattern: "\\#literal.ts" });
	expect(exclusion("src/drop.generated.ts", rules)).toMatchObject({
		reason: RUN_EXCLUSION_REASON.REVUE_IGNORE,
		pattern: "*.generated.ts",
	});
	expect(exclusion("src/keep.generated.ts", rules)).toBeUndefined();
	expect(exclusion("new-name.ts", rules, "old-name.ts")).toBeUndefined();
	expect(exclusion("session/value.ts", rules)).toMatchObject({
		reason: RUN_EXCLUSION_REASON.SESSION_IGNORE,
		pattern: "session/**",
		matchedPath: "session/value.ts",
	});
});
