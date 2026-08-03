package overlays

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

func fitToWidth(s string, width int) string {
	return kit.Fit(s, width, "…")
}
