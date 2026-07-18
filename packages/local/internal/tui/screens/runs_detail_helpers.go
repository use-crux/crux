package screens

import (
	"fmt"
	"image/color"
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// --- helpers ---------------------------------------------------------------

func (s *Runs) currentSpan() *api.InspectRunSpan {
	if s.detail == nil {
		return nil
	}
	for i, sp := range s.detail.Spans {
		if sp.ID == s.selSpan {
			return &s.detail.Spans[i]
		}
	}
	return nil
}

func parentLabel(span *api.InspectRunSpan) string {
	if span.ParentID == "" {
		return "— (root)"
	}
	return truncate(span.ParentID, 16)
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
	for _, k := range keys {
		if len(k) > keyW {
			keyW = len(k)
		}
	}
	if keyW > width/2 {
		keyW = width / 2
	}

	var b strings.Builder
	for _, k := range keys {
		v := attrs[k]
		row := fmt.Sprintf(" %s  %s",
			shell.TextDim.Render(padString2(k+":", keyW+1)),
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
func kvRow(k, v string, _ int) string {
	kCol := 14
	key := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(padString2(k, kCol))
	val := lipgloss.NewStyle().Foreground(shell.ColorText).Render(v)
	row := fmt.Sprintf(" %s %s", key, val)
	return row + "\n"
}

// kvRowColored is kvRow with a colored value.
func kvRowColored(k, v string, c color.Color, _ int) string {
	kCol := 14
	key := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(padString2(k, kCol))
	val := lipgloss.NewStyle().Foreground(c).Render(v)
	row := fmt.Sprintf(" %s %s", key, val)
	return row + "\n"
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
