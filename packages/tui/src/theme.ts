// A small Catppuccin-ish palette so Revue's shell reads cleanly on dark terminals.
// The renderer owns its matching diff-semantic palette independently.
export const theme = {
	accent: "#89b4fa",
	text: "#cdd6f4",
	dim: "#6c7086",
	green: "#a6e3a1",
	yellow: "#f9e2af",
	red: "#f38ba8",
	mauve: "#cba6f7",
	surface: "#313244",
} as const;

export const severityColor: Record<string, string> = {
	critical: theme.red,
	high: theme.red,
	medium: theme.yellow,
	info: theme.accent,
};

export const complexityColor: Record<string, string> = {
	low: theme.green,
	medium: theme.yellow,
	high: theme.red,
	"very-high": theme.red,
};
