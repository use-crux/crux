package kit

import (
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

const (
	borderUp = 1 << iota
	borderRight
	borderDown
	borderLeft
)

// ReconcileBorders turns intersecting pane rules into one connected junction
// graph. It preserves the existing ANSI styling and changes only box-drawing
// glyphs at actual rule intersections.
func ReconcileBorders(frame string) string {
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
