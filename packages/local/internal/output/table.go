package output

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
)

// Table renders a simple aligned table to stdout.
type Table struct {
	Headers []string
	Rows    [][]string
	// MinWidths per column (optional, auto-calculated if nil).
	MinWidths []int
}

// Render returns the formatted table string.
func (t *Table) Render() string {
	if len(t.Rows) == 0 && len(t.Headers) == 0 {
		return ""
	}

	cols := len(t.Headers)
	if cols == 0 && len(t.Rows) > 0 {
		cols = len(t.Rows[0])
	}

	// Calculate column widths from display width (lipgloss.Width), not byte
	// length, so ANSI escapes, CJK, and emoji align correctly (R9).
	widths := make([]int, cols)
	for i, h := range t.Headers {
		if w := lipgloss.Width(h); w > widths[i] {
			widths[i] = w
		}
	}
	for _, row := range t.Rows {
		for i, cell := range row {
			if i < cols {
				if w := lipgloss.Width(cell); w > widths[i] {
					widths[i] = w
				}
			}
		}
	}
	if t.MinWidths != nil {
		for i, mw := range t.MinWidths {
			if i < cols && mw > widths[i] {
				widths[i] = mw
			}
		}
	}

	var sb strings.Builder

	// Header.
	if len(t.Headers) > 0 {
		for i, h := range t.Headers {
			if i > 0 {
				sb.WriteString("  ")
			}
			sb.WriteString(padRight(h, widths[i]))
		}
		sb.WriteString("\n")
		// Separator.
		for i, w := range widths {
			if i > 0 {
				sb.WriteString("  ")
			}
			sb.WriteString(strings.Repeat("─", w))
		}
		sb.WriteString("\n")
	}

	// Rows.
	for _, row := range t.Rows {
		for i := 0; i < cols; i++ {
			if i > 0 {
				sb.WriteString("  ")
			}
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			sb.WriteString(padRight(cell, widths[i]))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// RenderTable returns table's formatted text through the command-facing output
// surface. Commands should use this instead of calling [Table.Render] directly,
// keeping direct renderer calls inside this package for the Phase 15 guard.
func (io *IO) RenderTable(table *Table) string {
	if table == nil {
		return ""
	}
	return table.Render()
}

// Print renders the table to stdout.
func (t *Table) Print() {
	fmt.Print(t.Render())
}

// padRight pads s with spaces to width display columns. It measures s with
// lipgloss.Width (ignoring ANSI escapes and counting wide characters as two
// columns) so styled and CJK/emoji cells align to the same boundary as plain
// ASCII. For pure-ASCII input the behavior is identical to byte-length padding.
func padRight(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}
