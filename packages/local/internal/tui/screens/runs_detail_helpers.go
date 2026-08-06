package screens

import (
	"fmt"
	"image/color"
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// --- helpers ---------------------------------------------------------------

func (s *Runs) currentSpan() *api.InspectRunSpan {
	selected, _, ok := s.spanList.Selected()
	if ok {
		span := selected.Span
		return &span
	}
	return nil
}

func (s *Runs) currentActivity() *api.ObservabilityRunDetailNode {
	selected, _, ok := s.spanList.Selected()
	if !ok || firstNonEmpty(selected.Activity.SpanID, selected.Activity.ID) == "" {
		return nil
	}
	activity := selected.Activity
	return &activity
}

func parentLabel(span *api.InspectRunSpan) string {
	if span.ParentID == "" {
		return "— (root)"
	}
	return truncateRunsInline(span.ParentID, 16)
}

func formatSpanStart(spanStart, traceStart int64) string {
	if spanStart == 0 {
		return "+0s"
	}
	delta := spanStart - traceStart
	if delta < 0 {
		delta = 0
	}
	if delta >= 1000 {
		return fmt.Sprintf("+%.2fs", float64(delta)/1000.0)
	}
	return fmt.Sprintf("+%dms", delta)
}

func durationColor(spanDur, traceDur *float64) color.Color {
	if spanDur == nil || traceDur == nil || *traceDur == 0 {
		return shell.ColorText
	}
	frac := *spanDur / *traceDur
	switch {
	case frac >= 0.6:
		return shell.ColorRose
	case frac >= 0.25:
		return shell.ColorAmber
	default:
		return shell.ColorText
	}
}

func tokenColor(n int) color.Color {
	switch {
	case n >= 10_000:
		return shell.ColorAmber
	case n >= 50_000:
		return shell.ColorRose
	default:
		return shell.ColorText
	}
}

func renderAttributes(attrs map[string]string, width int) string {
	// Sort keys for stable rendering.
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Determine key column width (cap at half the pane).
	keyW := 0
	for _, key := range keys {
		if width := lipgloss.Width(sanitizeRunsInline(key)); width > keyW {
			keyW = width
		}
	}
	if keyW > width/2 {
		keyW = width / 2
	}

	var b strings.Builder
	for _, k := range keys {
		v := sanitizeRunsInline(attrs[k])
		k = sanitizeRunsInline(k)
		row := fmt.Sprintf(" %s  %s",
			shell.TextDim.Render(padRunsInline(k+":", keyW+1)),
			shell.Text.Render(v),
		)
		b.WriteString(row)
		b.WriteString("\n")
	}
	return b.String()
}

func deref(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func commaInt(n int) string {
	s := fmt.Sprintf("%d", n)
	if n < 1000 {
		return s
	}
	// Insert thousands separators.
	out := make([]byte, 0, len(s)+len(s)/3)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, byte(c))
	}
	return string(out)
}

// kvRow is the standard `muted-key  value` row used in detail panes across
// screens. Defined here because Runs is the most invariant consumer; other
// screens import it via the package.
func kvRow(k, v string, width int) string {
	return labelValueRows(k, v, width, shell.ColorText)
}

// kvRowColored is kvRow with a colored value.
func kvRowColored(k, v string, c color.Color, width int) string {
	return labelValueRows(k, v, width, c)
}

func labelValueRows(label, value string, width int, valueColor color.Color) string {
	const preferredLabelWidth = 14
	labelWidth := min(preferredLabelWidth, max(1, width-3))
	valueStart := labelWidth + 2
	valueWidth := max(1, width-valueStart)
	label = kit.TruncateMiddle(kit.SanitizeInline(label), labelWidth, "…")
	value = kit.SanitizeInline(value)
	wrapped := strings.Split(lipgloss.Wrap(value, valueWidth, " /._-"), "\n")
	if len(wrapped) == 0 {
		wrapped = []string{""}
	}

	keyStyle := lipgloss.NewStyle().Foreground(shell.ColorTextMuted)
	valueStyle := lipgloss.NewStyle().Foreground(valueColor)
	lines := make([]string, 0, len(wrapped))
	for index, line := range wrapped {
		prefix := strings.Repeat(" ", valueStart)
		if index == 0 {
			prefix = " " + keyStyle.Render(padRunsInline(label, labelWidth)) + " "
		}
		lines = append(lines, kit.Fit(prefix+valueStyle.Render(line), width, "…"))
	}
	return strings.Join(lines, "\n") + "\n"
}

// padString2 right-pads an ASCII string with spaces to a fixed width.
func padString2(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}

func padString2Right(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return strings.Repeat(" ", width-len(s)) + s
}
