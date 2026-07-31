package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

const paneDivider = "│"

// Compose overlays pane line slices into their rectangles and draws gutters.
func Compose(rects []Rect, contents [][]string) []string {
	return compose(rects, contents, lipgloss.NewStyle())
}

// ComposeStyled is Compose with a theme-styled pane divider.
func ComposeStyled(rects []Rect, contents [][]string, styles theme.Styles) []string {
	return compose(rects, contents, styles.Border)
}

func compose(rects []Rect, contents [][]string, dividerStyle lipgloss.Style) []string {
	if len(rects) == 0 {
		return nil
	}
	w, h := bounds(rects)
	out := make([]string, h)
	for y := 0; y < h; y++ {
		var row strings.Builder
		x := 0
		for i, r := range rects {
			if r.X > x {
				row.WriteString(strings.Repeat(" ", r.X-x))
				x = r.X
			}
			line := ""
			if y >= r.Y && y < r.Y+r.H && i < len(contents) {
				localY := y - r.Y
				if localY < len(contents[i]) {
					line = contents[i][localY]
				}
			}
			row.WriteString(fitLine(line, r.W))
			x += r.W
			if i < len(rects)-1 {
				row.WriteString(dividerStyle.Render(paneDivider))
				x++
			}
		}
		line := row.String()
		if got := lipgloss.Width(line); got < w {
			line += strings.Repeat(" ", w-got)
		}
		out[y] = fitLine(line, w)
	}
	return strings.Split(ReconcileBorders(strings.Join(out, "\n")), "\n")
}

func bounds(rects []Rect) (int, int) {
	maxX, maxY := 0, 0
	for _, r := range rects {
		if x := r.X + nonNegative(r.W); x > maxX {
			maxX = x
		}
		if y := r.Y + nonNegative(r.H); y > maxY {
			maxY = y
		}
	}
	return maxX, maxY
}

func fitLine(s string, w int) string {
	return Fit(s, w, "…")
}
