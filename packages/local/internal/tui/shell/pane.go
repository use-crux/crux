package shell

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// PaneHeader renders the header strip at the top of a pane:
//
//	Title · 8 open                                 right-meta
//
// Subtle, single-line, single dim divider below. `width` is the pane width.
// `right` is rendered without further styling.
func PaneHeader(width int, title string, subtitle string, right string) string {
	// Title is in regular weight — design uses medium-weight white,
	// not bold. Previously we set Bold(true) which made titles compete
	// visually with the values inside each pane (the actual content
	// is what should draw the eye, not the header).
	mainStyle := lipgloss.NewStyle().Foreground(ColorText)
	muted := lipgloss.NewStyle().Foreground(ColorTextMuted)

	left := " " + mainStyle.Render(title)
	if subtitle != "" {
		left += "  " + muted.Render("· "+subtitle)
	}
	leftW := lipgloss.Width(left)
	rightW := lipgloss.Width(right)
	pad := width - leftW - rightW - 1
	if pad < 1 {
		pad = 1
	}
	row := left + strings.Repeat(" ", pad) + right + " "
	// Sandwich the title row with top + bottom dividers so every section
	// header has a clear top boundary regardless of what sits above it
	// in the composition (was: only a bottom rule, leaving stacked
	// sub-panes like "Recent runs" without a visible top edge whenever
	// the composer forgot to add a separator).
	titleRow := lipgloss.NewStyle().Width(width).Render(row)
	return horizontalBorderDim(width) + "\n" +
		titleRow + "\n" +
		horizontalBorderDim(width)
}

// PaneFooter renders the action bar at the bottom of a pane:
//
//	[s] save  [r] run  [c] compare  [p] promote  [x] dismiss
//
// Each key is a small `surface` chip with teal text; the label is dim. The
// strip itself sits on the panel background with a thin dim divider on top
// — matching the design's quiet, non-obstrusive feel.
func PaneFooter(width int, actions []Keybind) string {
	if len(actions) == 0 {
		return ""
	}
	keyChip := lipgloss.NewStyle().
		Background(ColorSurface).
		Foreground(ColorTeal).
		Padding(0, 1).
		MarginRight(1)
	labelStyle := lipgloss.NewStyle().Foreground(ColorTextDim)
	parts := make([]string, 0, len(actions))
	for _, k := range actions {
		parts = append(parts, keyChip.Render(k.Key)+labelStyle.Render(k.Label))
	}
	bar := " " + strings.Join(parts, "  ")
	pad := width - lipgloss.Width(bar)
	if pad > 0 {
		bar += strings.Repeat(" ", pad)
	}
	// No bg fill on the action bar — it sits on the same bg as the
	// pane content above it, separated only by the dim divider. Matches
	// the design's quiet, low-chrome feel.
	return horizontalBorderDim(width) + "\n" +
		lipgloss.NewStyle().Width(width).Render(bar)
}

// SelectionBar renders the 2-col left bar used to mark a selected row.
func SelectionBar(color lipgloss.Color) string {
	return lipgloss.NewStyle().Foreground(color).Render("▌")
}

// VBorder returns a vertical 1-column border between panes.
func VBorder(height int) string {
	line := lipgloss.NewStyle().Foreground(ColorBorder).Render("│")
	lines := make([]string, height)
	for i := range lines {
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

// Compose lays out columns horizontally, separated by a 1-col vertical border.
// Each input is the already-rendered column (height-padded).
func Compose(columns ...string) string {
	if len(columns) == 0 {
		return ""
	}
	// Split each column into lines.
	cols := make([][]string, len(columns))
	height := 0
	for i, c := range columns {
		cols[i] = strings.Split(c, "\n")
		if len(cols[i]) > height {
			height = len(cols[i])
		}
	}
	// Pad each column to equal height.
	for i := range cols {
		for len(cols[i]) < height {
			cols[i] = append(cols[i], "")
		}
	}
	// Glue rows with vertical border. Subtle `ColorBorder` (#242929)
	// rather than the brighter `ColorBorderBright` (#343b3b) — design
	// dividers are hairlines, not visible rules. Foreground-only so
	// the separator sits on whichever bg the columns already use.
	sep := lipgloss.NewStyle().Foreground(ColorBorder).Render("│")
	rows := make([]string, height)
	for r := 0; r < height; r++ {
		parts := make([]string, 0, len(cols)*2-1)
		for i, col := range cols {
			if i > 0 {
				parts = append(parts, sep)
			}
			parts = append(parts, col[r])
		}
		rows[r] = strings.Join(parts, "")
	}
	return strings.Join(rows, "\n")
}

func horizontalBorderDim(width int) string {
	// Use the subtler `ColorBorder` (#242929) instead of the
	// `ColorBorderBright` (#343b3b) the function used to render with.
	// The design's section dividers are barely-there hairlines — the
	// brighter shade was reading as a heavy rule. Foreground-only;
	// the line inherits whichever bg the surrounding content uses.
	return lipgloss.NewStyle().
		Foreground(ColorBorder).
		Render(strings.Repeat("─", width))
}

// horizontalBorder renders a solid border line against the main background.
// (Pulled out of the deleted tabs.go so breadcrumb.go can keep using it.)
func horizontalBorder(width int) string {
	return lipgloss.NewStyle().
		Foreground(ColorBorder).
		Background(ColorBG).
		Render(strings.Repeat("─", width))
}

// PadColumnHeight pads `body` (a multi-line string) to exactly `height` rows
// with empty lines at the bottom. Each line is right-padded with whitespace
// up to `width`.
//
// Important subtlety: lines coming in often carry ANSI background-color
// escapes (e.g. nav rail or status bar rows). Appending bare spaces to such
// lines breaks the bg because the unstyled spaces show through to the
// terminal default. To avoid that, we re-style the appended padding with
// the bg color carried at the *end* of the source line — preserving the
// visual block. Lines without a bg styling stay unstyled.
func PadColumnHeight(body string, width, height int) string {
	lines := strings.Split(strings.TrimRight(body, "\n"), "\n")
	for i, ln := range lines {
		lines[i] = padPreservingBG(ln, width)
	}
	// Filler rows are plain whitespace — no bg color. The previous
	// `Background(ColorPanel)` produced panel-tinted empty rows below
	// short content, which read as a band of darker color halfway down
	// the pane. Empty rows should be invisible (= terminal default bg).
	filler := strings.Repeat(" ", width)
	for len(lines) < height {
		lines = append(lines, filler)
	}
	if len(lines) > height {
		lines = lines[:height]
	}
	return strings.Join(lines, "\n")
}

// padPreservingBG appends spaces to s to reach `width`, wrapping the
// appended whitespace in the bg color implied by the trailing ANSI
// background escape (if any) so the padded section visually merges with
// the styled content.
func padPreservingBG(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		if w == width {
			return s
		}
		return lipgloss.NewStyle().MaxWidth(width).Render(s)
	}
	pad := width - w
	if bg := trailingBackground(s); bg != "" {
		return s + lipgloss.NewStyle().Background(lipgloss.Color(bg)).Render(strings.Repeat(" ", pad))
	}
	return s + strings.Repeat(" ", pad)
}

// trailingBackground inspects an ANSI-styled string and returns the
// hex-ish color string that was last applied as a background, or "" if
// the string has no bg or the bg has been reset. Scans the last open
// `\x1b[48;...m` sequence not closed by a reset.
func trailingBackground(s string) string {
	// Walk the string forwards, tracking the active bg.
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
				seq := buf.String()
				active = updateActiveBG(active, seq)
			}
			continue
		}
	}
	return active
}

// updateActiveBG returns the new active bg color given an existing one
// and a freshly observed `\x1b[...m` sequence. Recognizes truecolor bg
// (48;2;r;g;b), 256-color bg (48;5;n), and reset codes (0).
func updateActiveBG(current, seq string) string {
	if !strings.HasPrefix(seq, "\x1b[") || !strings.HasSuffix(seq, "m") {
		return current
	}
	body := strings.TrimSuffix(strings.TrimPrefix(seq, "\x1b["), "m")
	if body == "" || body == "0" {
		return "" // reset
	}
	parts := strings.Split(body, ";")
	// Walk segments left-to-right; resets clear, 48;2;R;G;B sets truecolor.
	for i := 0; i < len(parts); i++ {
		switch parts[i] {
		case "0":
			current = ""
		case "49":
			current = "" // default bg
		case "48":
			if i+1 < len(parts) && parts[i+1] == "2" && i+4 < len(parts) {
				r := parts[i+2]
				g := parts[i+3]
				b := parts[i+4]
				current = formatHexBG(r, g, b)
				i += 4
			} else if i+1 < len(parts) && parts[i+1] == "5" && i+2 < len(parts) {
				// 256-color — not a hex value; skip preserving bg in this
				// case (lipgloss writes truecolor by default).
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
	return "#" +
		hexByte(ri) + hexByte(gi) + hexByte(bi)
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

func padOrTruncate(s string, width int) string {
	w := lipgloss.Width(s)
	if w == width {
		return s
	}
	if w < width {
		return s + strings.Repeat(" ", width-w)
	}
	// Truncate — naïve byte cut, fine for our ASCII-heavy content.
	return lipgloss.NewStyle().MaxWidth(width).Render(s)
}
