package kit

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

const (
	borderUp = 1 << iota
	borderRight
	borderDown
	borderLeft
)

// ReconcileBorders turns intersecting pane rules into one connected junction
// graph, then normalizes every rule cell to the theme border tone on its
// active surface. Unpainted rule cells use the body surface.
func ReconcileBorders(frame string) string {
	return ReconcileBordersStyled(frame, adapterStyles)
}

// ReconcileBordersStyled is ReconcileBorders using the caller's resolved
// theme profile.
func ReconcileBordersStyled(frame string, styles theme.Styles) string {
	return normalizeBorderStyles(reconcileBorderGlyphs(frame), styles)
}

func reconcileBorderGlyphs(frame string) string {
	lines := strings.Split(frame, "\n")
	grid := make([]map[int]rune, len(lines))
	widths := make([]int, len(lines))
	for y, line := range lines {
		plain := ansi.Strip(line)
		grid[y] = borderCells(plain)
		widths[y] = lipgloss.Width(plain)
	}

	replacements := make([]map[int]rune, len(lines))
	for y, row := range grid {
		for x, glyph := range row {
			original := borderConnections(glyph)
			if original == 0 {
				continue
			}
			mask := 0
			if original&borderUp != 0 && y == 0 {
				mask |= borderUp
			}
			if y > 0 && borderConnections(grid[y-1][x])&(borderUp|borderDown) != 0 {
				mask |= borderUp
			}
			if original&borderRight != 0 && x+1 >= widths[y] {
				mask |= borderRight
			}
			if borderConnections(row[x+1])&(borderLeft|borderRight) != 0 {
				mask |= borderRight
			}
			if original&borderDown != 0 && y+1 == len(grid) {
				mask |= borderDown
			}
			if y+1 < len(grid) && borderConnections(grid[y+1][x])&(borderUp|borderDown) != 0 {
				mask |= borderDown
			}
			if original&borderLeft != 0 && x == 0 {
				mask |= borderLeft
			}
			if borderConnections(row[x-1])&(borderLeft|borderRight) != 0 {
				mask |= borderLeft
			}
			if joined := borderGlyph(mask); mask != original && joined != 0 {
				if replacements[y] == nil {
					replacements[y] = map[int]rune{}
				}
				replacements[y][x] = joined
			}
		}
	}

	for y := range lines {
		if len(replacements[y]) > 0 {
			lines[y] = replaceBorderCells(lines[y], replacements[y])
		}
	}
	return strings.Join(lines, "\n")
}

type ansiColors struct {
	foreground string
	background string
}

func normalizeBorderStyles(frame string, styles theme.Styles) string {
	borderForeground := renderedColors(styles.Border.Render("x")).foreground
	bodyBackground := renderedColors(styles.SurfaceBody.Render("x")).background
	lines := strings.Split(frame, "\n")
	for index := range lines {
		lines[index] = normalizeBorderLine(lines[index], borderForeground, bodyBackground)
	}
	return strings.Join(lines, "\n")
}

func normalizeBorderLine(line, borderForeground, bodyBackground string) string {
	var out strings.Builder
	active := ansiColors{}
	for offset := 0; offset < len(line); {
		if line[offset] == '\x1b' {
			end := escapeEnd(line, offset)
			sequence := line[offset:end]
			out.WriteString(sequence)
			if strings.HasPrefix(sequence, "\x1b[") && strings.HasSuffix(sequence, "m") {
				active = updateANSIColors(active, sequence[2:len(sequence)-1])
			}
			offset = end
			continue
		}
		glyph, size := utf8.DecodeRuneInString(line[offset:])
		if borderConnections(glyph) == 0 {
			out.WriteString(line[offset : offset+size])
			offset += size
			continue
		}

		background := active.background
		if background == "" {
			background = bodyBackground
		}
		if active.foreground == borderForeground && active.background == background {
			out.WriteString(line[offset : offset+size])
			offset += size
			continue
		}

		writeANSIColors(&out, borderForeground, background)
		out.WriteString(line[offset : offset+size])
		writeANSIColors(&out, active.foreground, active.background)
		offset += size
	}
	return out.String()
}

func writeANSIColors(out *strings.Builder, foreground, background string) {
	if foreground == "" {
		foreground = "39"
	}
	if background == "" {
		background = "49"
	}
	out.WriteString("\x1b[")
	out.WriteString(foreground)
	out.WriteByte(';')
	out.WriteString(background)
	out.WriteByte('m')
}

func renderedColors(value string) ansiColors {
	active := ansiColors{}
	for offset := 0; offset < len(value); {
		if value[offset] != '\x1b' {
			return active
		}
		end := escapeEnd(value, offset)
		sequence := value[offset:end]
		if strings.HasPrefix(sequence, "\x1b[") && strings.HasSuffix(sequence, "m") {
			active = updateANSIColors(active, sequence[2:len(sequence)-1])
		}
		offset = end
	}
	return active
}

func updateANSIColors(current ansiColors, parameters string) ansiColors {
	if parameters == "" {
		return ansiColors{}
	}
	parts := strings.Split(parameters, ";")
	for index := 0; index < len(parts); index++ {
		value, _ := strconv.Atoi(parts[index])
		switch {
		case value == 0:
			current = ansiColors{}
		case value == 39:
			current.foreground = ""
		case value == 49:
			current.background = ""
		case value >= 30 && value <= 37 || value >= 90 && value <= 97:
			current.foreground = parts[index]
		case value >= 40 && value <= 47 || value >= 100 && value <= 107:
			current.background = parts[index]
		case value == 38 || value == 48 || value == 58:
			color, consumed := ansiColorParameters(parts[index:])
			index += consumed
			if value == 38 {
				current.foreground = color
			} else if value == 48 {
				current.background = color
			}
		}
	}
	return current
}

func ansiColorParameters(parts []string) (string, int) {
	if len(parts) < 2 {
		return "", 0
	}
	switch parts[1] {
	case "2":
		if len(parts) >= 5 {
			return strings.Join(parts[:5], ";"), 4
		}
	case "5":
		if len(parts) >= 3 {
			return strings.Join(parts[:3], ";"), 2
		}
	}
	return "", 0
}

func borderCells(line string) map[int]rune {
	cells := map[int]rune{}
	x := 0
	for _, glyph := range line {
		if borderConnections(glyph) != 0 {
			cells[x] = glyph
		}
		x += lipgloss.Width(string(glyph))
	}
	return cells
}

func borderConnections(glyph rune) int {
	switch glyph {
	case '─':
		return borderLeft | borderRight
	case '│':
		return borderUp | borderDown
	case '┌', '╭':
		return borderRight | borderDown
	case '┐', '╮':
		return borderLeft | borderDown
	case '└', '╰':
		return borderRight | borderUp
	case '┘', '╯':
		return borderLeft | borderUp
	case '├':
		return borderUp | borderRight | borderDown
	case '┤':
		return borderUp | borderDown | borderLeft
	case '┬':
		return borderRight | borderDown | borderLeft
	case '┴':
		return borderUp | borderRight | borderLeft
	case '┼':
		return borderUp | borderRight | borderDown | borderLeft
	default:
		return 0
	}
}

func borderGlyph(mask int) rune {
	switch mask {
	case borderLeft | borderRight:
		return '─'
	case borderUp | borderDown:
		return '│'
	case borderRight | borderDown:
		return '┌'
	case borderLeft | borderDown:
		return '┐'
	case borderRight | borderUp:
		return '└'
	case borderLeft | borderUp:
		return '┘'
	case borderUp | borderRight | borderDown:
		return '├'
	case borderUp | borderDown | borderLeft:
		return '┤'
	case borderRight | borderDown | borderLeft:
		return '┬'
	case borderUp | borderRight | borderLeft:
		return '┴'
	case borderUp | borderRight | borderDown | borderLeft:
		return '┼'
	default:
		return 0
	}
}

func replaceBorderCells(line string, replacements map[int]rune) string {
	var out strings.Builder
	x := 0
	for offset := 0; offset < len(line); {
		if line[offset] == '\x1b' {
			end := escapeEnd(line, offset)
			out.WriteString(line[offset:end])
			offset = end
			continue
		}
		glyph, size := utf8.DecodeRuneInString(line[offset:])
		if replacement, ok := replacements[x]; ok {
			out.WriteRune(replacement)
		} else {
			out.WriteString(line[offset : offset+size])
		}
		x += lipgloss.Width(string(glyph))
		offset += size
	}
	return out.String()
}

func escapeEnd(value string, start int) int {
	if start+1 >= len(value) {
		return len(value)
	}
	switch value[start+1] {
	case '[':
		for index := start + 2; index < len(value); index++ {
			if value[index] >= 0x40 && value[index] <= 0x7e {
				return index + 1
			}
		}
	case ']':
		for index := start + 2; index < len(value); index++ {
			if value[index] == '\a' {
				return index + 1
			}
			if value[index] == '\x1b' && index+1 < len(value) && value[index+1] == '\\' {
				return index + 2
			}
		}
	default:
		return min(len(value), start+2)
	}
	return len(value)
}
