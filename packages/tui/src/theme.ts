import { resolveTheme, type Theme } from "@revue/theme";
import { createContext, useContext } from "react";

const ThemeContext = createContext<Theme>(resolveTheme(undefined));

export const ThemeProvider = ThemeContext.Provider;

/** The palette every part of the shell paints with. */
export const useTheme = (): Theme => useContext(ThemeContext);

export const severityColor = (theme: Theme, severity: string): string => {
	if (severity === "critical" || severity === "high") return theme.badgeRemoved;
	if (severity === "medium") return theme.badgeModified;
	return theme.accent;
};

export const complexityColor = (theme: Theme, level: string): string => {
	if (level === "low") return theme.badgeAdded;
	if (level === "medium") return theme.badgeModified;
	return theme.badgeRemoved;
};

/**
 * Difftastic styles its output with the terminal's own 16 colours. Map the ones it actually
 * emits onto the active theme so the read-only semantic view matches the rest of the shell.
 */
export const semanticAnsiPalette = (theme: Theme): Record<number, string> => ({
	30: theme.border,
	31: theme.removedSignColor,
	32: theme.addedSignColor,
	33: theme.badgeModified,
	34: theme.accent,
	35: theme.heading,
	36: theme.accent,
	37: theme.text,
	90: theme.muted,
	91: theme.removedSignColor,
	92: theme.addedSignColor,
	93: theme.badgeModified,
	94: theme.accent,
	95: theme.heading,
	96: theme.accent,
	97: theme.text,
});
