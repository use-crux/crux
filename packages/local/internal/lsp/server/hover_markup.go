package server

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

const maxHoverUTF16Units = 4_000

type hoverSection struct {
	prefix  string
	content string
	suffix  string
	atomic  bool
}

type cappedHoverWriter struct {
	value     strings.Builder
	units     int
	truncated bool
}

var markdownEscaper = strings.NewReplacer(
	`\`, `\\`,
	"`", "\\`",
	"*", "\\*",
	"_", "\\_",
	"[", "\\[",
	"]", "\\]",
	"<", "\\<",
	">", "\\>",
	"#", "\\#",
	"|", "\\|",
)

// escapeMarkdown makes an engine-owned string render as plain text in an LSP
// markdown payload.
func escapeMarkdown(value string) string {
	return markdownEscaper.Replace(normalizeEngineText(value))
}

func normalizeEngineText(value string) string {
	withoutControls := strings.Map(func(value rune) rune {
		if unicode.IsControl(value) {
			return ' '
		}
		return value
	}, value)
	return strings.Join(strings.Fields(withoutControls), " ")
}

func utf16Units(value string) int {
	units := 0
	for _, character := range value {
		units += utf16.RuneLen(character)
	}
	return units
}

func truncateUTF16(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	units := 0
	for index, character := range value {
		next := units + utf16.RuneLen(character)
		if next > limit {
			return value[:index]
		}
		units = next
	}
	return value
}

func (w *cappedHoverWriter) append(section hoverSection, separator string) bool {
	if w.truncated {
		return false
	}
	complete := separator + section.prefix + section.content + section.suffix
	completeUnits := utf16Units(complete)
	if w.units+completeUnits <= maxHoverUTF16Units {
		w.value.WriteString(complete)
		w.units += completeUnits
		return true
	}

	if section.atomic {
		w.appendEllipsis(separator)
		return false
	}
	overhead := utf16Units(separator+section.prefix+section.suffix) + utf16Units("…")
	available := maxHoverUTF16Units - w.units - overhead
	if available < 0 {
		w.appendEllipsis(separator)
		return false
	}
	clipped := strings.TrimRight(truncateUTF16(section.content, available), `\`)
	w.value.WriteString(separator)
	w.value.WriteString(section.prefix)
	w.value.WriteString(clipped)
	w.value.WriteString("…")
	w.value.WriteString(section.suffix)
	w.units += utf16Units(separator + section.prefix + clipped + "…" + section.suffix)
	w.truncated = true
	return false
}

func (w *cappedHoverWriter) appendEllipsis(separator string) {
	if w.units+utf16Units(separator+"…") <= maxHoverUTF16Units {
		w.value.WriteString(separator)
		w.value.WriteString("…")
		w.units += utf16Units(separator + "…")
	} else if w.units+utf16Units("…") <= maxHoverUTF16Units {
		w.value.WriteString("…")
		w.units += utf16Units("…")
	}
	w.truncated = true
}

func (w *cappedHoverWriter) String() string {
	return w.value.String()
}
