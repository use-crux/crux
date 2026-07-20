package kit

import (
	"strings"
	"unicode"

	"github.com/charmbracelet/x/ansi"
)

// SanitizeInline removes terminal controls and collapses structural newlines
// from authored or external text intended for one terminal row.
func SanitizeInline(value string) string {
	value = SanitizeMultiline(value)
	value = strings.ReplaceAll(value, "\t", "    ")
	return strings.ReplaceAll(value, "\n", " ")
}

// SanitizeMultiline removes terminal controls while retaining line structure.
// Tabs expand to spaces so terminal-cell bounds are emulator-independent.
func SanitizeMultiline(value string) string {
	value = ansi.Strip(value)
	var safe strings.Builder
	for _, char := range value {
		switch char {
		case '\n':
			safe.WriteByte('\n')
		case '\t':
			safe.WriteString("    ")
		default:
			if !unicode.IsControl(char) {
				safe.WriteRune(char)
			}
		}
	}
	return safe.String()
}
