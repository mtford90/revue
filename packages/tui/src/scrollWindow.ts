import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useEffect, useState } from "react";

export type ScrollWindow = {
	/** Scroll offset snapped down to `step`, so consumers replan rarely. */
	scrollTop: number;
	viewportHeight: number;
	/** Measured height of content above the windowed region, in rows. */
	leadingHeight: number;
};

const POLL_MS = 33;

/**
 * Tracks a scrollbox's window by polling: openTUI exposes no scroll event, only
 * imperative state. `scrollTop` is quantised to `step` rows and consumers keep
 * at least `step` rows of overscan beyond it, so a poll-lag frame can never
 * outrun the mounted content by design — only by fast flings.
 */
export const useScrollWindow = ({
	scrollRef,
	leadingRef,
	enabled,
	step,
}: {
	scrollRef: RefObject<ScrollBoxRenderable | null>;
	leadingRef?: RefObject<{ height: number } | null>;
	enabled: boolean;
	step: number;
}): ScrollWindow => {
	const [window, setWindow] = useState<ScrollWindow>({
		scrollTop: 0,
		viewportHeight: 0,
		leadingHeight: 0,
	});
	useEffect(() => {
		if (!enabled) return;
		const read = () => {
			const box = scrollRef.current;
			if (!box) return;
			const next: ScrollWindow = {
				scrollTop: Math.max(0, Math.floor(box.scrollTop / step) * step),
				viewportHeight: box.viewport.height,
				leadingHeight: leadingRef?.current?.height ?? 0,
			};
			setWindow((current) =>
				current.scrollTop === next.scrollTop &&
				current.viewportHeight === next.viewportHeight &&
				current.leadingHeight === next.leadingHeight
					? current
					: next,
			);
		};
		read();
		const timer = setInterval(read, POLL_MS);
		return () => clearInterval(timer);
	}, [scrollRef, leadingRef, enabled, step]);
	return window;
};
