package overlays

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var modalStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

func renderModal(inner string, width int) string {
	lines := strings.Split(inner, "\n")
	for index := range lines {
		lines[index] = theme.SurfaceLine(shell.SurfaceOverlay, lines[index], width)
	}
	background := shell.SurfaceOverlay.GetBackground()
	modal := lipgloss.NewStyle().
		Background(background).
		BorderBackground(background).
		BorderForeground(shell.ColorBorder).
		Border(lipgloss.RoundedBorder()).
		Render(strings.Join(lines, "\n"))
	return kit.ReconcileBordersStyled(modal, modalStyles)
}

const (
	modalMinWidth  = 40
	modalMinHeight = 8
)

type modalSize struct {
	innerWidth  int
	outerHeight int
}

// contentModalSize applies the shared overlay contract. longestLine excludes
// the one-cell content padding and border; chromeRows includes the border.
func contentModalSize(viewportWidth, viewportHeight, longestLine, contentRows, chromeRows int) modalSize {
	maxWidth := max(0, viewportWidth-4)
	outerWidth := clampModal(longestLine+4, modalMinWidth, maxWidth)
	maxHeight := max(0, viewportHeight*4/5)
	outerHeight := clampModal(contentRows+chromeRows, modalMinHeight, maxHeight)
	return modalSize{
		innerWidth:  max(1, outerWidth-2),
		outerHeight: outerHeight,
	}
}

func clampModal(value, minimum, maximum int) int {
	if maximum < minimum {
		return max(0, maximum)
	}
	return min(max(value, minimum), maximum)
}

func longestLineWidth(lines ...string) int {
	longest := 0
	for _, value := range lines {
		for _, line := range strings.Split(value, "\n") {
			longest = max(longest, lipgloss.Width(line))
		}
	}
	return longest
}
