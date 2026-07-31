package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

var adapterPalette = theme.Resolve(colorprofile.TrueColor)
var adapterStyles = theme.NewStyles(adapterPalette)

// PadBlock pads or clips a rendered block to exactly width by height cells.
//
// It is the adapter for legacy screens that still render string columns before
// their dedicated rebuild phases. New kit-native components should render from
// Rects directly.
func PadBlock(body string, width, height int) string {
	if height <= 0 || width <= 0 {
		return ""
	}
	lines := strings.Split(strings.TrimRight(body, "\n"), "\n")
	for i, ln := range lines {
		lines[i] = padPreservingBG(ln, width)
	}
	filler := strings.Repeat(" ", width)
	for len(lines) < height {
		lines = append(lines, filler)
	}
	if len(lines) > height {
		lines = lines[:height]
	}
	return strings.Join(lines, "\n")
}

// ComposeColumns joins already rendered legacy columns with kit dividers.
func ComposeColumns(columns ...string) string {
	composed := composeColumns(true, columns...)
	if composed == "" {
		return ""
	}
	width := lipgloss.Width(strings.Split(composed, "\n")[0])
	closed := composed + "\n" + ruleStyle(adapterStyles).Render(strings.Repeat("─", width))
	return ReconcileBorders(closed)
}

// ComposeColumnsOpen joins columns whose surrounding layout supplies the
// terminating horizontal boundary immediately after the returned block.
func ComposeColumnsOpen(columns ...string) string {
	return composeColumns(false, columns...)
}

func composeColumns(opaque bool, columns ...string) string {
	if len(columns) == 0 {
		return ""
	}
	rects := make([]Rect, len(columns))
	contents := make([][]string, len(columns))
	x := 0
	height := 0
	for i, col := range columns {
		lines := strings.Split(strings.TrimRight(col, "\n"), "\n")
		contents[i] = lines
		width := maxLineWidth(lines)
		if len(lines) > height {
			height = len(lines)
		}
		rects[i] = Rect{X: x, W: width}
		x += width + 1
	}
	for i := range rects {
		rects[i].H = height
	}
	if opaque {
		return strings.Join(ComposeStyled(rects, contents, adapterStyles), "\n")
	}
	return strings.Join(Compose(rects, contents), "\n")
}

func maxLineWidth(lines []string) int {
	max := 0
	for _, line := range lines {
		if w := lipgloss.Width(line); w > max {
			max = w
		}
	}
	return max
}

func padPreservingBG(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		if w == width {
			return s
		}
		return Fit(s, width, "…")
	}
	pad := width - w
	if bg := trailingBackground(s); bg != "" {
		return s + lipgloss.NewStyle().Background(lipgloss.Color(bg)).Render(strings.Repeat(" ", pad))
	}
	return s + strings.Repeat(" ", pad)
}

func trailingBackground(s string) string {
	active := ""
	inEscape := false
	var buf strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			buf.Reset()
			buf.WriteByte(c)
			buf.WriteByte('[')
			i++
			continue
		}
		if inEscape {
			buf.WriteByte(c)
			if c == 'm' {
				inEscape = false
				active = updateActiveBG(active, buf.String())
			}
		}
	}
	return active
}

func updateActiveBG(current, seq string) string {
	if !strings.HasPrefix(seq, "\x1b[") || !strings.HasSuffix(seq, "m") {
		return current
	}
	body := strings.TrimSuffix(strings.TrimPrefix(seq, "\x1b["), "m")
	if body == "" || body == "0" {
		return ""
	}
	parts := strings.Split(body, ";")
	for i := 0; i < len(parts); i++ {
		switch parts[i] {
		case "0", "49":
			current = ""
		case "48":
			if i+1 < len(parts) && parts[i+1] == "2" && i+4 < len(parts) {
				current = formatHexBG(parts[i+2], parts[i+3], parts[i+4])
				i += 4
			} else if i+1 < len(parts) && parts[i+1] == "5" && i+2 < len(parts) {
				i += 2
			}
		}
	}
	return current
}

func formatHexBG(r, g, b string) string {
	ri := atoiSafeInt(r)
	gi := atoiSafeInt(g)
	bi := atoiSafeInt(b)
	if ri < 0 || gi < 0 || bi < 0 {
		return ""
	}
	return "#" + hexByte(ri) + hexByte(gi) + hexByte(bi)
}

func atoiSafeInt(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
		if n > 255 {
			return -1
		}
	}
	return n
}

const hexDigits = "0123456789abcdef"

func hexByte(n int) string {
	if n < 0 {
		n = 0
	}
	if n > 255 {
		n = 255
	}
	return string(hexDigits[n>>4]) + string(hexDigits[n&0xf])
}
