package qualitycmd

// Pure formatting helpers shared by the Quality read-command renderers
// (`quality_read_progress.go`, `quality_read_evidence.go`). Kept free of IO so
// they stay trivially unit-testable; the renderers funnel them through
// output.IO for color gating.

import (
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/output"
)

// cellStatusKey maps a Quality cell status string to an output.Status key so
// the read commands reuse the same glyph/color vocabulary as the run reporter
// (passed→success ✓, failed/errored→error ✗, skipped→cancelled ⊘).
func cellStatusKey(status string) string {
	switch status {
	case "passed":
		return "success"
	case "failed", "errored":
		return "error"
	case "skipped":
		return "cancelled"
	default:
		return "running"
	}
}

// thresholdOperatorSymbol renders a score-threshold operator as a compact math
// symbol (gte→≥, lte→≤, …), falling back to the raw operator for anything the
// engine emits that has no symbol.
func thresholdOperatorSymbol(op string) string {
	switch op {
	case "gte", ">=":
		return "≥"
	case "lte", "<=":
		return "≤"
	case "gt", ">":
		return ">"
	case "lt", "<":
		return "<"
	case "eq", "==", "=":
		return "="
	case "neq", "!=", "<>":
		return "≠"
	default:
		return op
	}
}

// relativeFrom renders an RFC3339(Nano) timestamp relative to now ("8s ago",
// "5m ago", "2h ago", "3d ago"). It is the day-aware counterpart to
// output.FormatRelativeTime (which takes unix ms and tops out at hours) for the
// string timestamps the Quality records carry. Empty or unparseable input, and
// any future timestamp, render as a dim-friendly em dash.
func relativeFrom(now time.Time, rfc3339 string) string {
	if rfc3339 == "" {
		return "—"
	}
	t, err := time.Parse(time.RFC3339Nano, rfc3339)
	if err != nil {
		t, err = time.Parse(time.RFC3339, rfc3339)
		if err != nil {
			return "—"
		}
	}
	d := now.Sub(t)
	if d < 0 {
		d = 0
	}
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

// indentLines prefixes every non-empty line of block with indent, leaving blank
// lines untouched. Used to inset a rendered output.Table under a header.
func indentLines(block, indent string) string {
	lines := strings.Split(strings.TrimRight(block, "\n"), "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = indent + line
		}
	}
	return strings.Join(lines, "\n")
}

// optionalCost renders a *float64 cost as "$0.0042" when present, or "" when the
// record omits it, so an absent cost leaves a clean blank cell.
func optionalCost(cost *float64) string {
	if cost == nil {
		return ""
	}
	return output.FormatCost(*cost)
}
