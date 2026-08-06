import type { DecorationAnchor } from "@revue/diff";

/** Stable OpenTUI renderable id for the concrete row represented by an engine anchor. */
export function decorationAnchorId(
	anchor: Pick<DecorationAnchor, "fileId" | "side" | "lineNumber">,
): string {
	return `diff-decoration:${encodeURIComponent(anchor.fileId)}:${anchor.side}:${anchor.lineNumber}`;
}
