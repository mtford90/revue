#!/usr/bin/env bun
// Appends the native addon's Cargo dependency notices to a release licence bundle.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type CargoPackage = {
	name: string;
	version: string;
	license?: string | null;
	manifest_path: string;
};
type CargoMetadata = { packages: CargoPackage[] };
const manifest = process.argv[2] ?? "packages/diff/native/Cargo.toml";
const result = Bun.spawnSync({
	cmd: ["cargo", "metadata", "--format-version", "1", "--manifest-path", manifest],
	stdout: "pipe",
	stderr: "pipe",
});
if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
const metadata = JSON.parse(new TextDecoder().decode(result.stdout)) as CargoMetadata;
const licenceFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];
const licenceText = (directory: string) => {
	const path = licenceFiles.map((file) => join(directory, file)).find(existsSync);
	return path ? readFileSync(path, "utf8").trim() : null;
};
const entries = metadata.packages
	.filter((entry) => !entry.manifest_path.endsWith(manifest))
	.sort((left, right) =>
		`${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
	)
	.map((entry) => {
		const text = licenceText(dirname(entry.manifest_path));
		return `## ${entry.name}@${entry.version}\n\nLicence: ${entry.license ?? "UNKNOWN"}\n\n${text ? `\`\`\`\n${text}\n\`\`\`` : `No licence file was present beside ${basename(entry.manifest_path)}.`}`;
	});
console.log(["# Native addon third-party licences", "", ...entries, ""].join("\n\n"));
