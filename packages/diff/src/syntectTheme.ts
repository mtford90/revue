/**
 * Converts a Shiki foreground into the opaque RGB value a terminal can render.
 * Eight-digit colours are alpha-composited over the editor background.
 */
export function compositeTerminalForeground(
	foreground: string,
	background: string,
): string | undefined {
	const parse = (value: string): [number, number, number, number] | undefined => {
		const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(value);
		if (!match) return undefined;
		const rgb = match[1];
		if (!rgb) return undefined;
		return [
			Number.parseInt(rgb.slice(0, 2), 16),
			Number.parseInt(rgb.slice(2, 4), 16),
			Number.parseInt(rgb.slice(4, 6), 16),
			match[2] ? Number.parseInt(match[2], 16) : 255,
		];
	};
	const source = parse(foreground);
	const surface = parse(background);
	if (!source || !surface) return undefined;
	const alpha = source[3] / 255;
	const channel = (value: number, under: number) => Math.round(value * alpha + under * (1 - alpha));
	return `#${[
		channel(source[0], surface[0]),
		channel(source[1], surface[1]),
		channel(source[2], surface[2]),
	]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")}`;
}
