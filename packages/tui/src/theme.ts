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
