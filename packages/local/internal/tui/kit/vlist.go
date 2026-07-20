package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
)

// VList is a virtualized cursor list.
//
// The list owns only cursor/offset state. Callers own item data and provide a
// pure row renderer at render time.
type VList[T any] struct {
	items    []T
	cursor   int
	offset   int
	height   int
	identity func(T) string
	rowH     func(T) int
}

// SetItems replaces the backing items, preserving the cursor by identity when
// SetIdentity has been configured.
func (l *VList[T]) SetItems(items []T) {
	prevID := ""
	if l.identity != nil && len(l.items) > 0 && l.cursor >= 0 && l.cursor < len(l.items) {
		prevID = l.identity(l.items[l.cursor])
	}
	l.items = items
	if prevID != "" {
		for i, item := range items {
			if l.identity(item) == prevID {
				l.cursor = i
				l.ensureVisible()
				return
			}
		}
	}
	l.ensureVisible()
}

// SetIdentity sets the stable identity function used across SetItems calls.
func (l *VList[T]) SetIdentity(fn func(T) string) {
	l.identity = fn
}

// SetRowHeight sets the per-item row height used for virtualization.
func (l *VList[T]) SetRowHeight(fn func(T) int) {
	l.rowH = fn
	l.ensureVisible()
}

// SetCursorByIdentity moves the cursor to id when the identity function is set.
func (l *VList[T]) SetCursorByIdentity(id string) bool {
	if l.identity == nil || id == "" {
		return false
	}
	for i, item := range l.items {
		if l.identity(item) == id {
			l.cursor = i
			l.ensureVisible()
			return true
		}
	}
	return false
}

// SetHeight sets the visible row budget.
func (l *VList[T]) SetHeight(h int) {
	l.height = nonNegative(h)
	l.ensureVisible()
}

// Offset returns the item index at the top of the visible window.
func (l *VList[T]) Offset() int {
	return l.offset
}

// Cursor returns the selected item, its index, and whether an item exists.
func (l *VList[T]) Cursor() (T, int, bool) {
	var zero T
	if len(l.items) == 0 || l.cursor < 0 || l.cursor >= len(l.items) {
		return zero, 0, false
	}
	return l.items[l.cursor], l.cursor, true
}

// CursorUp moves the cursor one item up.
func (l *VList[T]) CursorUp() {
	l.move(-1)
}

// CursorDown moves the cursor one item down.
func (l *VList[T]) CursorDown() {
	l.move(1)
}

// PageUp moves the cursor up by one visible page.
func (l *VList[T]) PageUp() {
	l.move(-max(1, l.visibleCapacity()))
}

// PageDown moves the cursor down by one visible page.
func (l *VList[T]) PageDown() {
	l.move(max(1, l.visibleCapacity()))
}

// Home moves the cursor to the first item.
func (l *VList[T]) Home() {
	if len(l.items) == 0 {
		return
	}
	l.cursor = 0
	l.ensureVisible()
}

// End moves the cursor to the last item.
func (l *VList[T]) End() {
	if len(l.items) == 0 {
		return
	}
	l.cursor = len(l.items) - 1
	l.ensureVisible()
}

// Render returns the visible rows clipped to w cells.
func (l *VList[T]) Render(w int, row func(item T, i int, selected bool, w int) string) []string {
	if w <= 0 || l.height <= 0 || len(l.items) == 0 {
		return nil
	}
	var out []string
	used := 0
	for i := l.offset; i < len(l.items) && used < l.height; i++ {
		item := l.items[i]
		rendered := strings.Split(strings.TrimRight(row(item, i, i == l.cursor, w), "\n"), "\n")
		for _, line := range rendered {
			if used >= l.height {
				break
			}
			out = append(out, fitLine(line, w))
			used++
		}
	}
	l.applyScrollIndicators(out, w)
	return out
}

func (l *VList[T]) move(delta int) {
	if len(l.items) == 0 {
		return
	}
	l.cursor += delta
	l.clamp()
	l.ensureVisible()
}

func (l *VList[T]) clamp() {
	if len(l.items) == 0 {
		l.cursor = 0
		l.offset = 0
		return
	}
	if l.cursor < 0 {
		l.cursor = 0
	}
	if l.cursor >= len(l.items) {
		l.cursor = len(l.items) - 1
	}
	maxOffset := len(l.items) - l.visibleCapacity()
	if maxOffset < 0 {
		maxOffset = 0
	}
	if l.offset > maxOffset {
		l.offset = maxOffset
	}
	if l.offset < 0 {
		l.offset = 0
	}
}

func (l *VList[T]) ensureVisible() {
	l.clamp()
	if len(l.items) == 0 || l.height <= 0 {
		return
	}
	if l.cursor < l.offset {
		l.offset = l.cursor
	}
	for l.cursor >= l.offset+l.visibleCapacity() && l.offset < len(l.items)-1 {
		l.offset++
	}
	l.clamp()
}

func (l *VList[T]) visibleCapacity() int {
	if l.height <= 0 {
		return 1
	}
	rows := 0
	count := 0
	for i := l.offset; i < len(l.items); i++ {
		h := l.itemHeight(l.items[i])
		if count > 0 && rows+h > l.height {
			break
		}
		rows += h
		count++
		if rows >= l.height {
			break
		}
	}
	if count < 1 {
		count = 1
	}
	return count
}

func (l *VList[T]) itemHeight(item T) int {
	if l.rowH == nil {
		return 1
	}
	return max(1, l.rowH(item))
}

func (l *VList[T]) applyScrollIndicators(lines []string, w int) {
	if len(lines) == 0 || w <= 0 {
		return
	}
	if l.offset > 0 {
		lines[0] = replaceLastCell(lines[0], w, "▲")
	}
	if l.offset+l.visibleCapacity() < len(l.items) {
		lines[len(lines)-1] = replaceLastCell(lines[len(lines)-1], w, "▼")
	}
}

func replaceLastCell(line string, w int, marker string) string {
	if w <= 0 {
		return ""
	}
	base := fitLine(line, w)
	if w == 1 {
		return marker
	}
	prefix := lipgloss.NewStyle().MaxWidth(w - 1).Render(base)
	if got := lipgloss.Width(prefix); got < w-1 {
		prefix += strings.Repeat(" ", w-1-got)
	}
	return prefix + marker
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
