import { z } from "zod";
import { sha256Schema } from "./run.ts";

export const HANDOFF_SCHEMA_VERSION = 1 as const;
export const HANDOFF_DELIVERY_KIND = {
	QUEUED: "queued",
	DELIVERED: "delivered",
	COPIED: "copied",
} as const;

/**
 * What became of the wake-up prompt. `queued` is the durable outcome and the only one the record
 * is first written with: delivery, when a host can do it, rewrites the record in place.
 */
export const handoffDeliverySchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal(HANDOFF_DELIVERY_KIND.QUEUED) }),
	z.strictObject({
		kind: z.literal(HANDOFF_DELIVERY_KIND.DELIVERED),
		host: z.literal("orca"),
		/** The host's handle for the terminal the prompt went to. */
		terminal: z.string().min(1),
		/** That terminal's title as the host reported it, sanitised by the host module. */
		title: z.string(),
	}),
	z.strictObject({ kind: z.literal(HANDOFF_DELIVERY_KIND.COPIED) }),
]);
export type HandoffDelivery = z.infer<typeof handoffDeliverySchema>;

/**
 * The reviewer's last batch of feedback, written before any delivery is attempted so the agent
 * finds the work even when no prompt reaches it. `handoffId` is the identity a waiter compares:
 * `requestedAt` is informational, and two sends in one millisecond must not read as one.
 *
 * `runId` records what the batch was requested against rather than where its threads live now.
 * Threads migrate across supersession (ADR 0018) and the handoff does not, so readers resolve
 * `threadIds` against the current run instead of trusting this id.
 */
export const handoffRecordSchema = z.strictObject({
	schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
	handoffId: z.uuid(),
	requestedAt: z.iso.datetime(),
	runId: sha256Schema,
	threadIds: z.array(z.uuid()),
	delivery: handoffDeliverySchema,
});
export type HandoffRecord = z.infer<typeof handoffRecordSchema>;
