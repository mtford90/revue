import { execFileSync } from "node:child_process";
import type { CliRenderer } from "@opentui/core";

const copyLocally = (text: string): boolean => {
	if (process.platform !== "darwin") return false;
	try {
		execFileSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
		return true;
	} catch {
		return false;
	}
};

/**
 * OSC 52 is the only clipboard channel that survives ssh and a multiplexer, but a
 * terminal can drop it without saying so, hence the local pipe alongside it.
 */
export const copyToClipboard = (renderer: CliRenderer, text: string): boolean => {
	const viaTerminal = renderer.copyToClipboardOSC52(text);
	return copyLocally(text) || viaTerminal;
};
