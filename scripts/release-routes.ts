import { relative } from "node:path";

export type Product = "revue" | "revuediff";
type RouteName = Product | "shared" | "ignored";

export type RouteConfig = Record<RouteName, string[]>;

const products = ["revue", "revuediff"] as const;
const root = `${import.meta.dir}/..`;
const configPath = `${root}/release-routes.json`;
const relativeGeneratedPaths: Record<Product, string> = {
	revue: ".release-please/revue/route.json",
	revuediff: ".release-please/revuediff/route.json",
};
const generatedPaths: Record<Product, string> = {
	revue: `${root}/${relativeGeneratedPaths.revue}`,
	revuediff: `${root}/${relativeGeneratedPaths.revuediff}`,
};

function matches(path: string, rule: string): boolean {
	return rule.endsWith("/") ? path.startsWith(rule) : path === rule;
}

export function classifyPath(path: string, config: RouteConfig): RouteName {
	const matchesByRoute = (Object.keys(config) as RouteName[]).filter((route) =>
		config[route].some((rule) => matches(path, rule)),
	);
	if (matchesByRoute.length !== 1) {
		throw new Error(
			matchesByRoute.length === 0
				? `release route missing for ${path}`
				: `release routes overlap for ${path}: ${matchesByRoute.join(", ")}`,
		);
	}
	return matchesByRoute[0];
}

export function productsForPath(path: string, config: RouteConfig): Product[] {
	switch (classifyPath(path, config)) {
		case "shared":
			return ["revue", "revuediff"];
		case "revue":
			return ["revue"];
		case "revuediff":
			return ["revuediff"];
		case "ignored":
			return [];
	}
}

function normalizedContent(path: string, content: Uint8Array): Uint8Array {
	if (!path.endsWith("package.json")) return content;
	const parsed = JSON.parse(new TextDecoder().decode(content));
	if (typeof parsed.version === "string") parsed.version = "<release-managed>";
	return new TextEncoder().encode(`${JSON.stringify(parsed, null, "\t")}\n`);
}

export async function buildRouteFiles(
	paths: string[],
	config: RouteConfig,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Record<Product, string>> {
	const routedPaths: Record<Product, string[]> = { revue: [], revuediff: [] };
	for (const path of [...paths].sort()) {
		for (const product of productsForPath(path, config)) routedPaths[product].push(path);
	}

	const output = {} as Record<Product, string>;
	for (const product of products) {
		const hasher = new Bun.CryptoHasher("sha256");
		for (const path of routedPaths[product]) {
			hasher.update(path);
			hasher.update("\0");
			hasher.update(normalizedContent(path, await readFile(path)));
			hasher.update("\0");
		}
		output[product] = `${JSON.stringify(
			{
				schemaVersion: 1,
				product,
				sourceCount: routedPaths[product].length,
				sourceDigest: `sha256:${hasher.digest("hex")}`,
			},
			null,
			"\t",
		)}\n`;
	}
	return output;
}

function runGit(cwd: string, args: string[]): Uint8Array {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
	}
	return result.stdout;
}

const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
const nulSeparated = (value: Uint8Array): string[] => decode(value).split("\0").filter(Boolean);

async function routeFilesForTree(
	commit: string,
	config: RouteConfig,
	cwd: string,
): Promise<Record<Product, string>> {
	const paths = nulSeparated(runGit(cwd, ["ls-tree", "-r", "--name-only", "-z", commit]));
	return buildRouteFiles(paths, config, async (path) => runGit(cwd, ["show", `${commit}:${path}`]));
}

function treeFile(commit: string, path: string, cwd: string): string {
	const result = Bun.spawnSync({
		cmd: ["git", "show", `${commit}:${path}`],
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	return result.exitCode === 0 ? decode(result.stdout) : "";
}

/** Conventional Commits permits project-specific types; Release Please parses the same shape. */
export function isConventionalCommit(message: string): boolean {
	return /^[a-z][a-z0-9-]*(?:\([^)\r\n]+\))?!?: [^\s]/.test(message);
}

export type CommitRangeCheckOptions = {
	base: string;
	head: string;
	cwd?: string;
	config?: RouteConfig;
};

/**
 * Verify the invariant Release Please relies on when it splits commits by touched files: every
 * conventional commit whose routed source state changes must carry each affected product ledger,
 * and that ledger must describe that commit's complete tree.
 */
export async function checkCommitRange({
	base,
	head,
	cwd = root,
	config,
}: CommitRangeCheckOptions): Promise<string[]> {
	const commits = decode(runGit(cwd, ["rev-list", "--reverse", "--topo-order", `${base}..${head}`]))
		.trim()
		.split("\n")
		.filter(Boolean);
	const errors: string[] = [];
	for (const commit of commits) {
		const message = decode(runGit(cwd, ["show", "-s", "--format=%B", commit]));
		if (!isConventionalCommit(message)) continue;
		const commitConfig =
			config ?? (JSON.parse(treeFile(commit, "release-routes.json", cwd)) as RouteConfig);
		const parents = decode(runGit(cwd, ["show", "-s", "--format=%P", commit]))
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		const parent = parents[0];
		if (!parent) continue;
		const [before, after] = await Promise.all([
			routeFilesForTree(parent, commitConfig, cwd),
			routeFilesForTree(commit, commitConfig, cwd),
		]);
		const changedPaths = new Set(
			nulSeparated(
				runGit(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", parent, commit]),
			),
		);
		const subject = message.split("\n", 1)[0];
		for (const product of products) {
			if (before[product] === after[product]) continue;
			const ledgerPath = relativeGeneratedPaths[product];
			if (!changedPaths.has(ledgerPath)) {
				errors.push(`${commit.slice(0, 12)} ${subject}: missing same-commit ${ledgerPath}`);
				continue;
			}
			if (treeFile(commit, ledgerPath, cwd) !== after[product]) {
				errors.push(
					`${commit.slice(0, 12)} ${subject}: ${ledgerPath} does not match the commit tree`,
				);
			}
		}
	}
	return errors;
}

async function repositoryPaths(): Promise<string[]> {
	return nulSeparated(
		runGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
	);
}

export async function expectedRouteFiles(): Promise<Record<Product, string>> {
	const config = (await Bun.file(configPath).json()) as RouteConfig;
	return buildRouteFiles(
		await repositoryPaths(),
		config,
		async (path) => new Uint8Array(await Bun.file(`${root}/${path}`).arrayBuffer()),
	);
}

async function checkTip(): Promise<boolean> {
	const expected = await expectedRouteFiles();
	let stale = false;
	for (const product of products) {
		const path = generatedPaths[product];
		const actual = await Bun.file(path)
			.text()
			.catch(() => "");
		if (actual !== expected[product]) {
			console.error(`${relative(root, path)} is stale; run bun run release-routes:update`);
			stale = true;
		}
	}
	return !stale;
}

async function main(): Promise<void> {
	const mode = process.argv[2];
	if (mode === "update") {
		const expected = await expectedRouteFiles();
		for (const product of products) {
			const path = generatedPaths[product];
			await Bun.write(path, expected[product]);
			console.log(`updated ${relative(root, path)}`);
		}
		return;
	}
	if (mode === "check") {
		if (!(await checkTip())) process.exitCode = 1;
		return;
	}
	if (mode === "check-range") {
		const [base, head] = process.argv.slice(3);
		if (!base || !head) {
			throw new Error("usage: bun scripts/release-routes.ts check-range <base> <head>");
		}
		const errors = await checkCommitRange({ base, head });
		for (const error of errors) console.error(error);
		if (errors.length > 0) process.exitCode = 1;
		else console.log(`release routes valid for ${base.slice(0, 12)}..${head.slice(0, 12)}`);
		return;
	}
	throw new Error("usage: bun scripts/release-routes.ts <update|check|check-range>");
}

if (import.meta.main) await main();
