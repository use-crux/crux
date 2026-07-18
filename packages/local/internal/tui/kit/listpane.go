package kit

import tea "charm.land/bubbletea/v2"

// ListPosition describes the selected and visible position of a ListPane.
type ListPosition struct {
	SelectedIndex int
	Total         int
	Offset        int
}

// ListPane owns focus, sizing, stable selection, and scrolling for a flat
// selectable list. Callers retain ownership of filtering and row rendering.
type ListPane[T any] struct {
	list    VList[T]
	width   int
	height  int
	focused bool
}

// NewListPane constructs a pane with the stable identity used across refreshes.
// The identity function must return a unique, non-empty ID for every row.
func NewListPane[T any](identity func(T) string) *ListPane[T] {
	if identity == nil {
		panic("kit: ListPane identity is required")
	}
	pane := &ListPane[T]{}
	pane.list.SetIdentity(identity)
	return pane
}

// SetItems replaces the pane rows while preserving stable selection where
// possible.
func (p *ListPane[T]) SetItems(items []T) {
	p.list.SetItems(items)
}

// SetRowHeight configures the row budget each item occupies.
func (p *ListPane[T]) SetRowHeight(height func(T) int) {
	p.list.SetRowHeight(height)
}

// SetSize updates the concrete rendering bounds and keeps selection visible.
func (p *ListPane[T]) SetSize(width, height int) {
	p.width = nonNegative(width)
	p.height = nonNegative(height)
	p.list.SetHeight(p.height)
}

// SetFocused controls whether Update consumes navigation input.
func (p *ListPane[T]) SetFocused(focused bool) {
	p.focused = focused
}

// Select moves selection to the row with id and reports whether it exists.
func (p *ListPane[T]) Select(id string) bool {
	return p.list.SetCursorByIdentity(id)
}

// Selected returns the selected row, its zero-based index, and whether it
// exists.
func (p *ListPane[T]) Selected() (T, int, bool) {
	return p.list.Cursor()
}

// Position returns zero-based selection and offset metadata. SelectedIndex is
// -1 when the pane is empty.
func (p *ListPane[T]) Position() ListPosition {
	_, index, ok := p.list.Cursor()
	if !ok {
		index = -1
	}
	return ListPosition{
		SelectedIndex: index,
		Total:         len(p.list.items),
		Offset:        p.list.Offset(),
	}
}

// Update applies focused keyboard and mouse navigation and reports whether the
// pane consumed the message.
func (p *ListPane[T]) Update(msg tea.Msg) bool {
	if !p.focused {
		return false
	}
	if wheel, ok := msg.(tea.MouseWheelMsg); ok {
		switch wheel.Button {
		case tea.MouseWheelDown:
			p.list.CursorDown()
			return true
		case tea.MouseWheelUp:
			p.list.CursorUp()
			return true
		default:
			return false
		}
	}
	key, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return false
	}
	switch key.String() {
	case "j", "down":
		p.list.CursorDown()
		return true
	case "k", "up":
		p.list.CursorUp()
		return true
	case "pgdown":
		p.list.PageDown()
		return true
	case "pgup":
		p.list.PageUp()
		return true
	case "home":
		p.list.Home()
		return true
	case "end":
		p.list.End()
		return true
	default:
		return false
	}
}

// Render returns the visible rows clipped to the pane's concrete size.
func (p *ListPane[T]) Render(row func(item T, index int, selected bool, width int) string) []string {
	return p.list.Render(p.width, row)
}
