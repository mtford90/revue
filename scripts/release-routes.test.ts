import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRouteFiles,
	checkCommitRange,
	productsForPath,
	type RouteConfig,
} from "./release-routes";

const config = (await Bun.file(`${import.meta.dir}/../release-routes.json`).json()) as RouteConfig;

const temporaryRepositories: string[] = [];
afterEach(async () => {
	await Promise.all(temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true })));
});

const fixtureConfig: RouteConfig = {
	ignored: [".release-please/revue/", ".release-please/revuediff/"],
	shared: ["shared/"],
	revue: ["revue/"],
	revuediff: ["revuediff/"],
};
const fixturePaths = [
	".release-please/revue/route.json",
	".release-please/revuediff/route.json",
	"revue/app.ts",
	"revuediff/app.ts",
	"shared/core.ts",
];

function git(cwd: string, args: string[]): string {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
	return new TextDecoder().decode(result.stdout).trim();
}

async function writeFixtureLedgers(directory: string, only?: "revue" | "revuediff") {
	const expected = await buildRouteFiles(
		fixturePaths,
		fixtureConfig,
		async (path) => new Uint8Array(await Bun.file(join(directory, path)).arrayBuffer()),
	);
	for (const product of ["revue", "revuediff"] as const) {
		if (!only || only === product)
			await writeFile(join(directory, `.release-please/${product}/route.json`), expected[product]);
	}
}

async function createFixtureRepository(): Promise<{ directory: string; base: string }> {
	const directory = await mkdtemp(join(tmpdir(), "release-routes-"));
	temporaryRepositories.push(directory);
	git(directory, ["init", "--quiet"]);
	git(directory, ["config", "user.email", "routes@example.com"]);
	git(directory, ["config", "user.name", "Route Test"]);
	await Promise.all([
		mkdir(join(directory, ".release-please/revue"), { recursive: true }),
		mkdir(join(directory, ".release-please/revuediff"), { recursive: true }),
		mkdir(join(directory, "revue")),
		mkdir(join(directory, "revuediff")),
		mkdir(join(directory, "shared")),
	]);
	await Promise.all([
		writeFile(join(directory, "revue/app.ts"), "export const revue = 1;\n"),
		writeFile(join(directory, "revuediff/app.ts"), "export const revuediff = 1;\n"),
		writeFile(join(directory, "shared/core.ts"), "export const shared = 1;\n"),
		writeFile(join(directory, ".release-please/revue/route.json"), ""),
		writeFile(join(directory, ".release-please/revuediff/route.json"), ""),
	]);
	await writeFixtureLedgers(directory);
	git(directory, ["add", "."]);
	git(directory, ["commit", "--quiet", "-m", "chore: add baseline"]);
	return { directory, base: git(directory, ["rev-parse", "HEAD"]) };
}

describe("release routing", () => {
	test.each([
		["packages/tui/src/main.tsx", ["revue"]],
		["site/install.sh", ["revue"]],
		[".github/workflows/release.yml", ["revue"]],
		["packages/revuediff/src/main.ts", ["revuediff"]],
		["packages/diff-ansi/src/index.ts", ["revuediff"]],
		["site/revuediff/install.sh", ["revuediff"]],
		["scripts/revuediff-release-smoke.sh", ["revuediff"]],
		["scripts/generate-revuediff-tap-formula.sh", ["revuediff"]],
		[".github/workflows/revuediff-release.yml", ["revuediff"]],
		["packages/diff/src/index.ts", ["revue", "revuediff"]],
		["packages/theme/src/index.ts", ["revue", "revuediff"]],
	] as const)("routes %s only to its affected products", (path, products) => {
		expect(productsForPath(path, config)).toEqual(products);
	});

	test("binds each generated marker to refreshable independent Release Please components", async () => {
		const releaseConfig = await Bun.file(`${import.meta.dir}/../release-please-config.json`).json();
		const manifest = await Bun.file(`${import.meta.dir}/../.release-please-manifest.json`).json();
		const releaseWorkflow = await Bun.file(
			`${import.meta.dir}/../.github/workflows/release-please.yml`,
		).text();
		const ciWorkflow = await Bun.file(`${import.meta.dir}/../.github/workflows/ci.yml`).text();
		expect(releaseConfig["always-update"]).toBe(true);
		expect(Object.keys(releaseConfig.packages)).toEqual([
			".release-please/revue",
			".release-please/revuediff",
		]);
		expect(releaseConfig.packages[".release-please/revue"]).toMatchObject({
			component: "revue",
			"include-component-in-tag": false,
		});
		expect(releaseConfig.packages[".release-please/revuediff"]).toMatchObject({
			component: "revuediff",
			"include-component-in-tag": true,
			"initial-version": "0.1.0",
		});
		expect(manifest).toEqual({ ".release-please/revue": "0.5.0" });
		expect(await Bun.file(`${import.meta.dir}/../.release-please/revue/version.txt`).text()).toBe(
			"0.5.0\n",
		);
		expect(
			await Bun.file(`${import.meta.dir}/../.release-please/revuediff/version.txt`).text(),
		).toBe("0.1.0\n");
		expect(releaseWorkflow).toContain(".release-please/revue--release_created");
		expect(releaseWorkflow).toContain(".release-please/revuediff--release_created");
		expect(ciWorkflow).toContain("fetch-depth: 0");
		expect(ciWorkflow).toContain("github.event.pull_request.base.sha || github.event.before");
		expect(ciWorkflow).toContain("github.event.pull_request.head.sha || github.sha");
		expect(ciWorkflow).toContain("scripts/release-routes.ts check-range");
	});

	test("changes only the generated marker for affected products", async () => {
		const contents: Record<string, string> = {
			"packages/tui/src/main.tsx": "revue",
			"packages/revuediff/src/main.ts": "revuediff",
			"packages/diff/src/index.ts": "shared",
		};
		const paths = Object.keys(contents);
		const read = async (path: string) => new TextEncoder().encode(contents[path]);
		const before = await buildRouteFiles(paths, config, read);

		contents["packages/revuediff/src/main.ts"] = "changed";
		const afterRevuediff = await buildRouteFiles(paths, config, read);
		expect(afterRevuediff.revue).toBe(before.revue);
		expect(afterRevuediff.revuediff).not.toBe(before.revuediff);

		contents["packages/revuediff/src/main.ts"] = "revuediff";
		contents["packages/diff/src/index.ts"] = "changed";
		const afterShared = await buildRouteFiles(paths, config, read);
		expect(afterShared.revue).not.toBe(before.revue);
		expect(afterShared.revuediff).not.toBe(before.revuediff);
	});

	test("release-managed package versions do not make the routing ledger stale", async () => {
		const paths = ["package.json", "packages/revuediff/package.json"];
		const contents: Record<string, string> = {
			"package.json": '{"name":"revue","version":"0.4.0"}',
			"packages/revuediff/package.json": '{"name":"revuediff","version":"0.1.0"}',
		};
		const read = async (path: string) => new TextEncoder().encode(contents[path]);
		const before = await buildRouteFiles(paths, config, read);
		contents["package.json"] = '{"name":"revue","version":"0.5.0"}';
		contents["packages/revuediff/package.json"] = '{"name":"revuediff","version":"0.2.0"}';
		expect(await buildRouteFiles(paths, config, read)).toEqual(before);
	});

	test("rejects a conventional source commit without its same-commit ledger", async () => {
		const { directory, base } = await createFixtureRepository();
		await writeFile(join(directory, "revue/app.ts"), "export const revue = 2;\n");
		git(directory, ["add", "."]);
		git(directory, ["commit", "--quiet", "-m", "feat: change revue"]);
		const errors = await checkCommitRange({
			base,
			head: "HEAD",
			cwd: directory,
			config: fixtureConfig,
		});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("missing same-commit .release-please/revue/route.json");
	});

	test("accepts a conventional source commit with its matching same-commit ledger", async () => {
		const { directory, base } = await createFixtureRepository();
		await writeFile(join(directory, "revue/app.ts"), "export const revue = 2;\n");
		await writeFixtureLedgers(directory, "revue");
		git(directory, ["add", "."]);
		git(directory, ["commit", "--quiet", "-m", "feat: change revue"]);
		expect(
			await checkCommitRange({ base, head: "HEAD", cwd: directory, config: fixtureConfig }),
		).toEqual([]);
	});

	test("requires both product ledgers for a conventional shared source change", async () => {
		const { directory, base } = await createFixtureRepository();
		await writeFile(join(directory, "shared/core.ts"), "export const shared = 2;\n");
		await writeFixtureLedgers(directory, "revue");
		git(directory, ["add", "."]);
		git(directory, ["commit", "--quiet", "-m", "fix: change shared core"]);
		const errors = await checkCommitRange({
			base,
			head: "HEAD",
			cwd: directory,
			config: fixtureConfig,
		});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("missing same-commit .release-please/revuediff/route.json");
	});

	test("committed generated markers match every routed source", async () => {
		const process = Bun.spawn({
			cmd: ["bun", "scripts/release-routes.ts", "check"],
			cwd: `${import.meta.dir}/..`,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([
			process.exited,
			new Response(process.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
	});
});
