export type { IntralinePair, IntralineRange, IntralineSpans } from "./intraline.ts";
export { intralineSpans, pairChangedLines } from "./intraline.ts";
export { countDiffStats, createDiffFile, inferLanguage, parsePatch } from "./model.ts";
export type { DiffFile, DiffFileInput, DiffStats } from "./types.ts";
