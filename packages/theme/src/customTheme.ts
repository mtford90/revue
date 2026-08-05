import { z } from "zod";

/**
 * The shape of a custom theme file, before it is loaded. Only the root is validated as an object;
 * every key's value is left as `unknown` so a wrong-typed value drops just that key rather than
 * the whole file. Whether `extends` names a real theme, whether colour values are valid
 * `#rgb`/`#rrggbb`, and whether each value is the right type are all the loader's job.
 */
export const CustomThemeFileSchema = z.object({
	extends: z.unknown().optional(),
	label: z.unknown().optional(),
	background: z.unknown().optional(),
	foreground: z.unknown().optional(),
	diffColors: z.unknown().optional(),
	syntaxTheme: z.unknown().optional(),
	overrides: z.unknown().optional(),
});

export type CustomThemeFile = z.infer<typeof CustomThemeFileSchema>;
