package shell

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

// Breadcrumb renders the thin row above each screen body:
//
//	inspect / insights / INS-014               · 8 of 8 shown ·
//
// `path` is the dotted hierarchy (last item highlighted), `right` is the
// optional context note printed flush-right.
func Breadcrumb(width int, path []string, right string) string {
	if width <= 0 {
		return ""
	}
	dim := lipgloss.NewStyle().Foreground(ColorTextDim)
	muted := lipgloss.NewStyle().Foreground(ColorTextMuted)
	active := lipgloss.NewStyle().Foreground(ColorTeal)

	cleanPath := make([]string, 0, len(path))
	for _, part := range path {
		cleanPath = append(cleanPath, kit.SanitizeInline(part))
	}
	meta := breadcrumbMeta(right)
	for len(meta) > 0 && breadcrumbContentWidth(cleanPath, meta) > width {
		meta = meta[:len(meta)-1]
	}
	if breadcrumbContentWidth(cleanPath, meta) > width {
		cleanPath = truncateBreadcrumbTail(cleanPath, width)
	}

	parts := make([]string, 0, len(cleanPath)*2)
	for i, p := range cleanPath {
		if i > 0 {
			parts = append(parts, muted.Render(" / "))
		}
		if i == len(cleanPath)-1 {
			parts = append(parts, active.Render(p))
		} else {
			parts = append(parts, dim.Render(p))
		}
	}
	left := " " + strings.Join(parts, "")
	rightR := ""
	if len(meta) > 0 {
		rightR = muted.Render(strings.Join(meta, "  ·  ")) + " "
	}

	leftW := lipgloss.Width(left)
	rightW := lipgloss.Width(rightR)
	pad := width - leftW - rightW
	if pad < 1 {
		pad = 1
	}

	row := kit.Fit(left+strings.Repeat(" ", pad)+rightR, width, "…")
	// No bg fill — breadcrumb sits on the same bg as the screen body
	// below it, separated only by the divider line. Matches the design's
	// uniform dark theme without an extra panel band at the top.
	return row + "\n" + horizontalBorder(width)
}

func breadcrumbMeta(right string) []string {
	right = strings.NewReplacer("\r", " ", "\n", " ", "\t", "    ").Replace(right)
	raw := strings.Split(right, "  ·  ")
	meta := make([]string, 0, len(raw))
	for _, part := range raw {
		if part = strings.TrimSpace(part); part != "" {
			meta = append(meta, part)
		}
	}
	return meta
}

func breadcrumbContentWidth(path, meta []string) int {
	width := 2 // one outer space on each side
	if len(path) > 0 {
		width += lipgloss.Width(strings.Join(path, " / "))
	}
	if len(meta) > 0 {
		width += 1 + lipgloss.Width(strings.Join(meta, "  ·  "))
	}
	return width
}

func truncateBreadcrumbTail(path []string, width int) []string {
	if len(path) == 0 {
		return path
	}
	fixed := 2
	for _, part := range path[:len(path)-1] {
		fixed += lipgloss.Width(part) + lipgloss.Width(" / ")
	}
	tailWidth := width - fixed
	if tailWidth > 0 {
		path[len(path)-1] = kit.TruncateMiddle(path[len(path)-1], tailWidth, "…")
		return path
	}
	return []string{kit.TruncateMiddle(strings.Join(path, " / "), max(0, width-2), "…")}
}

// FrameScreen joins the breadcrumb and active screen without stacking the
// breadcrumb divider on top of a pane's own leading divider.
func FrameScreen(width int, breadcrumb, screen string) string {
	if startsWithHorizontalRule(screen, width) {
		// Keep the breadcrumb boundary and discard the duplicate leading screen
		// rule. Preserve its row budget with a structural continuation row so
		// pane dividers still reach the status seam.
		if _, rest, found := strings.Cut(screen, "\n"); found {
			screen = rest
		} else {
			screen = ""
		}
		last := screen
		if index := strings.LastIndexByte(screen, '\n'); index >= 0 {
			last = screen[index+1:]
		}
		screen += "\n" + verticalContinuation(last, width)
	}
	return breadcrumb + "\n" + screen
}

func verticalContinuation(line string, width int) string {
	cells := []rune(strings.Repeat(" ", width))
	x := 0
	for _, glyph := range ansi.Strip(line) {
		if x >= width {
			break
		}
		if strings.ContainsRune("│┌┐├┤┬┼", glyph) {
			cells[x] = '│'
		}
		x += lipgloss.Width(string(glyph))
	}
	plain := string(cells)
	if !strings.ContainsRune(plain, '│') {
		return plain
	}
	border := lipgloss.NewStyle().Foreground(ColorBorder).Background(ColorBG)
	return strings.ReplaceAll(plain, "│", border.Render("│"))
}

func startsWithHorizontalRule(value string, width int) bool {
	first, _, _ := strings.Cut(value, "\n")
	plain := ansi.Strip(first)
	if lipgloss.Width(plain) != width || !strings.ContainsRune(plain, '─') {
		return false
	}
	for _, glyph := range plain {
		switch glyph {
		case '─', '│', '┬', '┴', '├', '┤', '┼':
		default:
			return false
		}
	}
	return true
}
