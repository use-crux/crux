package screens

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

const (
	evalsMinimumBodyWidth  = 60
	evalsMinimumBodyHeight = 17
	evalsMinimumLabel      = "60×20"
)

type evalsLayoutMode uint8

const (
	evalsLayoutTooSmall evalsLayoutMode = iota
	evalsLayoutNarrow
	evalsLayoutSplit
)

type evalsLayout struct {
	size   Size
	mode   evalsLayoutMode
	list   kit.Rect
	detail kit.Rect
}

func (s *Evals) Resize(size Size) {
	s.size = Size{Width: max(0, size.Width), Height: max(0, size.Height)}
	s.layout = prepareEvalsLayout(s.size)
	s.catalog.SetSize(s.layout.list.W, max(0, s.layout.list.H-3))
	s.detail.SetSize(s.layout.detail.W, max(0, s.layout.detail.H-3))
	s.syncDetail(false)
}

func prepareEvalsLayout(size Size) evalsLayout {
	root := kit.Rect{W: size.Width, H: size.Height}
	layout := evalsLayout{size: size, mode: evalsLayoutNarrow, list: root, detail: root}
	if root.W < evalsMinimumBodyWidth || root.H < evalsMinimumBodyHeight {
		layout.mode = evalsLayoutTooSmall
		return layout
	}
	if root.W < 92 {
		return layout
	}
	listWidth := min(48, max(36, root.W*34/100))
	panes := kit.SplitH(root, kit.Fixed(listWidth), kit.Fill())
	layout.mode = evalsLayoutSplit
	layout.list, layout.detail = panes[0], panes[1]
	return layout
}
