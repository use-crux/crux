package uitest

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
)

// BackgroundSpan is one contiguous terminal-cell run with the same active
// ANSI background. An empty Color is the terminal default background.
type BackgroundSpan struct {
	Start int
	End   int
	Color string
}

// BackgroundSpans extracts exact background-color runs from one ANSI row.
func BackgroundSpans(row string) []BackgroundSpan {
	colors := make([]string, 0, lipgloss.Width(row))
	background := ""
	for offset := 0; offset < len(row); {
		if row[offset] == '\x1b' {
			end := ansiSequenceEnd(row, offset)
			if offset+1 < len(row) && row[offset+1] == '[' && end > offset && row[end-1] == 'm' {
				background = updateBackground(background, row[offset+2:end-1])
			}
			offset = end
			continue
		}
		glyph, size := utf8.DecodeRuneInString(row[offset:])
		for range lipgloss.Width(string(glyph)) {
			colors = append(colors, background)
		}
		offset += size
	}
	if len(colors) == 0 {
		return nil
	}
	spans := make([]BackgroundSpan, 0, 4)
	start := 0
	for index := 1; index <= len(colors); index++ {
		if index == len(colors) || colors[index] != colors[start] {
			spans = append(spans, BackgroundSpan{Start: start, End: index, Color: colors[start]})
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

func updateBackground(current, parameters string) string {
	if parameters == "" {
		return ""
	}
	parts := strings.Split(parameters, ";")
	for index := 0; index < len(parts); index++ {
		value, _ := strconv.Atoi(parts[index])
		switch {
		case value == 0 || value == 49:
			current = ""
		case value >= 40 && value <= 47:
			current = fmt.Sprintf("ansi:%d", value-40)
		case value >= 100 && value <= 107:
			current = fmt.Sprintf("ansi:%d", value-92)
		case (value == 38 || value == 58) && index+1 < len(parts):
			mode, _ := strconv.Atoi(parts[index+1])
			if mode == 2 && index+4 < len(parts) {
				index += 4
			} else if mode == 5 && index+2 < len(parts) {
				index += 2
			}
		case value == 48 && index+1 < len(parts):
			mode, _ := strconv.Atoi(parts[index+1])
			switch mode {
			case 2:
				if index+4 < len(parts) {
					current = "rgb:" + strings.Join(parts[index+2:index+5], ",")
					index += 4
				}
			case 5:
				if index+2 < len(parts) {
					current = "index:" + parts[index+2]
					index += 2
				}
			}
		}
	}
	return current
}
