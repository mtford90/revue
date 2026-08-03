type RgbColor = { r: number; g: number; b: number };

const hexToRgb = (hex: string): RgbColor => {
	const normalized = /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace(/^#/, "") : "000000";
	const value = Number.parseInt(normalized, 16);
	return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
};

/** Blend a foreground colour toward a background colour at a fixed ratio. */
export const blendHex = (fg: string, bg: string, ratio: number): string => {
	const foreground = hexToRgb(fg);
	const background = hexToRgb(bg);
	const mix = (front: number, back: number) =>
		Math.max(0, Math.min(255, Math.round(back + (front - back) * ratio)));
	const blended =
		(mix(foreground.r, background.r) << 16) |
		(mix(foreground.g, background.g) << 8) |
		mix(foreground.b, background.b);
	return `#${blended.toString(16).padStart(6, "0")}`;
};

const linearizedChannel = (channel: number): number => {
	const value = channel / 255;
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance for a `#rrggbb` colour. */
export const relativeLuminance = (hex: string): number => {
	const color = hexToRgb(hex);
	return (
		0.2126 * linearizedChannel(color.r) +
		0.7152 * linearizedChannel(color.g) +
		0.0722 * linearizedChannel(color.b)
	);
};

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export const contrastRatio = (foreground: string, background: string): number => {
	const foregroundLuminance = relativeLuminance(foreground);
	const backgroundLuminance = relativeLuminance(background);
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
};
