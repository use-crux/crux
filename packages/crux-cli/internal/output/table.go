package output

import (
	"fmt"
	"strings"
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

	// Calculate column widths.
	widths := make([]int, cols)
	for i, h := range t.Headers {
		if len(h) > widths[i] {
			widths[i] = len(h)
		}
	}
	for _, row := range t.Rows {
		for i, cell := range row {
			if i < cols && len(cell) > widths[i] {
				widths[i] = len(cell)
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
			sb.WriteString(Bold.Render(padRight(h, widths[i])))
		}
		sb.WriteString("\n")
		// Separator.
		for i, w := range widths {
			if i > 0 {
				sb.WriteString("  ")
			}
			sb.WriteString(Dim.Render(strings.Repeat("─", w)))
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

// Print renders the table to stdout.
func (t *Table) Print() {
	fmt.Print(t.Render())
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
