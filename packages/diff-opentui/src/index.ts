export {
	attachmentAnchoredAt,
	attachmentsForExcerptLine,
	attachmentsForRow,
	type DiffInlineAttachment,
	type DiffInlineAttachmentPlacement,
	type InlineAttachmentGeometry,
	inlineAttachmentGeometry,
	MIN_USABLE_INLINE_ATTACHMENT_WIDTH,
} from "./attachments.ts";
export {
	DiagramBlock,
	DiffBody,
	type DiffBodyProps,
	type DiffBodyStandaloneProps,
	type DiffBodySuppliedPlanProps,
	DiffFileHeader,
	type DiffFileHeaderProps,
	ExcerptBlock,
	type ExpandDirection,
	FILE_STATUS_TAG_WIDTH,
	type FileStatus,
	FileStatusTag,
	useResolvedInlineAttachmentPlacement,
} from "./components.tsx";
export { decorationAnchorId } from "./ids.ts";
export { diffLineId, diffRangeWithin } from "./selectionIds.ts";
export { OPENTUI_DIFF_CHROME } from "./styles.ts";
