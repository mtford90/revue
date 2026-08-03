#!/usr/bin/env bun
// Collects licence texts for every third-party package reachable from the workspace's
// production dependencies, for inclusion in release archives: a compiled executable
// redistributes these packages, so their notices must ship alongside it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Manifest = {
	name?: string;
	version?: string;
	license?: unknown;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

type PackageRecord = {
	name: string;
	version: string;
	license: string;
	directory: string;
	dependencyNames: string[];
};

const LICENCE_FILES = [
	"LICENSE",
	"LICENSE.md",
	"LICENSE.txt",
	"LICENCE",
	"LICENCE.md",
	"COPYING",
	"LICENSE-MIT",
	"LICENSE-MIT.txt",
];

const repoRoot = resolve(import.meta.dir, "..");

const readManifest = (path: string): Manifest | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
};

const externalDependencyNames = (manifest: Manifest): string[] =>
	Object.entries({
		...manifest.dependencies,
		...manifest.peerDependencies,
		...manifest.optionalDependencies,
	})
		.filter(([, range]) => !String(range).startsWith("workspace:"))
		.map(([name]) => name);

const licenceId = (value: unknown): string =>
	typeof value === "string" ? value : value ? JSON.stringify(value) : "UNKNOWN";

const licenceText = (directory: string): string | null => {
	const found = LICENCE_FILES.map((file) => join(directory, file)).find(existsSync);
	return found ? readFileSync(found, "utf8").trim() : null;
};

const installedPackages = (): Map<string, PackageRecord[]> => {
	const byName = new Map<string, PackageRecord[]>();
	const glob = new Bun.Glob("node_modules/.bun/*/node_modules/**/package.json");
	for (const path of glob.scanSync({ cwd: repoRoot, dot: true })) {
		const manifest = readManifest(join(repoRoot, path));
		if (!manifest?.name || !manifest.version) continue;
		const record: PackageRecord = {
			name: manifest.name,
			version: manifest.version,
			license: licenceId(manifest.license),
			directory: dirname(join(repoRoot, path)),
			dependencyNames: externalDependencyNames(manifest),
		};
		const existing = byName.get(record.name) ?? [];
		if (!existing.some((entry) => entry.version === record.version)) {
			byName.set(record.name, [...existing, record]);
		}
	}
	return byName;
};

const workspaceRootNames = (): string[] => {
	const glob = new Bun.Glob("packages/*/package.json");
	return [...glob.scanSync({ cwd: repoRoot })].flatMap((path) => {
		const manifest = readManifest(join(repoRoot, path));
		return manifest ? externalDependencyNames(manifest) : [];
	});
};

const productionClosure = (
	byName: Map<string, PackageRecord[]>,
	rootNames: string[],
): { records: PackageRecord[]; missing: string[] } => {
	const visited = new Set<string>();
	const missing = new Set<string>();
	const queue = [...rootNames];
	const records: PackageRecord[] = [];
	for (let index = 0; index < queue.length; index++) {
		const name = queue[index];
		if (!name || visited.has(name)) continue;
		visited.add(name);
		const entries = byName.get(name);
		if (!entries) {
			missing.add(name);
			continue;
		}
		records.push(...entries);
		queue.push(...entries.flatMap((entry) => entry.dependencyNames));
	}
	return { records, missing: [...missing].sort() };
};

const formatDocument = (records: PackageRecord[]): string => {
	const sorted = [...records].sort((a, b) =>
		`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
	);
	const sections = sorted.map((record) => {
		const text = licenceText(record.directory);
		const body = text
			? `\`\`\`\n${text}\n\`\`\``
			: `No licence file was distributed with this package; see its repository for the ${record.license} terms.`;
		return `## ${record.name}@${record.version}\n\nLicence: ${record.license}\n\n${body}`;
	});
	return [
		"# Bundled third-party licences",
		"",
		"The revue executable bundles the packages below. Each section reproduces the licence",
		"that package was distributed under.",
		"",
		sections.join("\n\n"),
		"",
	].join("\n");
};

const outputPath = process.argv[2];
if (!outputPath) {
	process.stderr.write("usage: bun scripts/collect-licenses.ts <output-file>\n");
	process.exit(2);
}

const { records, missing } = productionClosure(installedPackages(), workspaceRootNames());
if (records.length === 0) {
	process.stderr.write("No installed packages found — run `bun install` first.\n");
	process.exit(1);
}
for (const name of missing) {
	process.stderr.write(`warning: ${name} is depended on but not installed; skipped\n`);
}
await Bun.write(outputPath, formatDocument(records));
process.stderr.write(`Wrote ${records.length} package licences to ${outputPath}\n`);
