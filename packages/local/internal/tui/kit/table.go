package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// Align controls table-cell text alignment.
type Align int

const (
	// AlignLeft left-aligns table cells.
	AlignLeft Align = iota
	// AlignRight right-aligns table cells.
	AlignRight
)

// Col describes one table column for item type T.
type Col[T any] struct {
	Title string
	C     Constraint
	Align Align
	Tone  func(T) theme.Tone
	Value func(T) string
}

// Table is a virtualized, rect-bounded table.
type Table[T any] struct {
	cols []Col[T]
	list VList[T]
}

// NewTable creates a table with cols.
func NewTable[T any](cols []Col[T]) *Table[T] {
	return &Table[T]{cols: cols}
}

// SetItems replaces table rows.
func (t *Table[T]) SetItems(items []T) {
	t.list.SetItems(items)
}

// SetIdentity sets stable row identity.
func (t *Table[T]) SetIdentity(fn func(T) string) {
	t.list.SetIdentity(fn)
}

// SetHeight sets the total table height including header and divider rows.
func (t *Table[T]) SetHeight(h int) {
	t.list.SetHeight(nonNegative(h) - 2)
}

// Render renders the table to exactly the available rows.
func (t *Table[T]) Render(w int, styles theme.Styles) []string {
	if w <= 0 {
		return nil
	}
	colRects := SplitH(Rect{W: w, H: 1}, colConstraints(t.cols)...)
	widths := make([]int, len(colRects))
	for i, r := range colRects {
		widths[i] = r.W
	}
	lines := []string{
		t.renderRow(w, widths, styles.Dim, headerValues(t.cols), nil),
		styles.Border.Render(strings.Repeat("─", w)),
	}
	body := t.list.Render(w, func(item T, _ int, selected bool, rowW int) string {
		style := styles.Regular
		if selected {
			style = styles.Selected
		}
		return t.renderRow(rowW, widths, style, nil, &item)
	})
	lines = append(lines, body...)
	return lines
}

func colConstraints[T any](cols []Col[T]) []Constraint {
	out := make([]Constraint, len(cols))
	for i, col := range cols {
		out[i] = col.C
	}
	return out
}

func headerValues[T any](cols []Col[T]) []string {
	out := make([]string, len(cols))
	for i, col := range cols {
		out[i] = col.Title
	}
	return out
}

func (t *Table[T]) renderRow(w int, widths []int, defaultStyle interface{ Render(...string) string }, headers []string, item *T) string {
	parts := make([]string, len(widths))
	for i, width := range widths {
		value := ""
		align := AlignLeft
		if item == nil {
			value = headers[i]
		} else if i < len(t.cols) {
			if t.cols[i].Value != nil {
				value = t.cols[i].Value(*item)
			}
			align = t.cols[i].Align
		}
		parts[i] = alignCell(defaultStyle.Render(value), width, align)
	}
	return fitLine(strings.Join(parts, "│"), w)
}

func alignCell(s string, w int, align Align) string {
	if lipgloss.Width(s) > w {
		return fitLine(s, w)
	}
	pad := w - lipgloss.Width(s)
	if pad <= 0 || align != AlignRight {
		return s + strings.Repeat(" ", pad)
	}
	return strings.Repeat(" ", pad) + s
}
