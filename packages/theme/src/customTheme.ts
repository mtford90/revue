import { z } from "zod";

/**
 * The shape of a custom theme file, before it is loaded. This is shape-only: whether `extends`
 * names a real theme, and whether colour values are valid `#rgb`/`#rrggbb`, are the loader's job.
 */
export const CustomThemeFileSchema = z.object({
	extends: z.string().optional(),
	label: z.string().optional(),
	background: z.string().optional(),
	foreground: z.string().optional(),
	diffColors: z
		.object({
			added: z.string().optional(),
			removed: z.string().optional(),
			modified: z.string().optional(),
		})
		.optional(),
	syntaxTheme: z.string().optional(),
	overrides: z.record(z.string(), z.string()).optional(),
});

export type CustomThemeFile = z.infer<typeof CustomThemeFileSchema>;
