package uitest

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
)

// CellStyle is the computed ANSI color state for one terminal cell. Empty
// colors are terminal defaults.
type CellStyle struct {
	Foreground string
	Background string
}

// BackgroundSpan is one contiguous terminal-cell run with the same active
// ANSI background. An empty Color is the terminal default background.
type BackgroundSpan struct {
	Start int
	End   int
	Color string
}

// CellStyles extracts the computed foreground and background for every cell in
// one ANSI row.
func CellStyles(row string) []CellStyle {
	styles := make([]CellStyle, 0, lipgloss.Width(row))
	current := CellStyle{}
	for offset := 0; offset < len(row); {
		if row[offset] == '\x1b' {
			end := ansiSequenceEnd(row, offset)
			if offset+1 < len(row) && row[offset+1] == '[' && end > offset && row[end-1] == 'm' {
				current = updateCellStyle(current, row[offset+2:end-1])
			}
			offset = end
			continue
		}
		glyph, size := utf8.DecodeRuneInString(row[offset:])
		for range lipgloss.Width(string(glyph)) {
			styles = append(styles, current)
		}
		offset += size
	}
	return styles
}

// BackgroundSpans extracts exact background-color runs from one ANSI row.
func BackgroundSpans(row string) []BackgroundSpan {
	styles := CellStyles(row)
	if len(styles) == 0 {
		return nil
	}
	spans := make([]BackgroundSpan, 0, 4)
	start := 0
	for index := 1; index <= len(styles); index++ {
		if index == len(styles) || styles[index].Background != styles[start].Background {
			spans = append(spans, BackgroundSpan{Start: start, End: index, Color: styles[start].Background})
			start = index
		}
	}
	return spans
}

func ansiSequenceEnd(value string, start int) int {
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

func updateCellStyle(current CellStyle, parameters string) CellStyle {
	if parameters == "" {
		return CellStyle{}
	}
	parts := strings.Split(parameters, ";")
	for index := 0; index < len(parts); index++ {
		value, _ := strconv.Atoi(parts[index])
		switch {
		case value == 0:
			current = CellStyle{}
		case value == 39:
			current.Foreground = ""
		case value == 49:
			current.Background = ""
		case value >= 30 && value <= 37:
			current.Foreground = fmt.Sprintf("ansi:%d", value-30)
		case value >= 90 && value <= 97:
			current.Foreground = fmt.Sprintf("ansi:%d", value-82)
		case value >= 40 && value <= 47:
			current.Background = fmt.Sprintf("ansi:%d", value-40)
		case value >= 100 && value <= 107:
			current.Background = fmt.Sprintf("ansi:%d", value-92)
		case value == 38 || value == 48 || value == 58:
			color, consumed := extendedColor(parts[index:])
			index += consumed
			switch value {
			case 38:
				current.Foreground = color
			case 48:
				current.Background = color
			}
		}
	}
	return current
}

func extendedColor(parts []string) (string, int) {
	if len(parts) < 2 {
		return "", 0
	}
	mode, _ := strconv.Atoi(parts[1])
	switch mode {
	case 2:
		if len(parts) >= 5 {
			return "rgb:" + strings.Join(parts[2:5], ","), 4
		}
	case 5:
		if len(parts) >= 3 {
			return "index:" + parts[2], 2
		}
	}
	return "", 0
}
