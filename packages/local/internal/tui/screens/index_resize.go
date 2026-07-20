package screens

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

const (
	indexMinimumBodyWidth  = 60
	indexMinimumBodyHeight = 17
	indexMinimumLabel      = "60×20"
)

type indexFocus uint8

const (
	indexFocusDefinitions indexFocus = iota
	indexFocusDetail
)

type indexLayoutMode uint8

const (
	indexLayoutTooSmall indexLayoutMode = iota
	indexLayoutNarrow
	indexLayoutSplit
)

type indexLayout struct {
	size   Size
	mode   indexLayoutMode
	list   kit.Rect
	detail kit.Rect
}

// Resize distributes the concrete body size to Index's stateful panes.
func (s *Index) Resize(size Size) {
	s.size = Size{Width: max(0, size.Width), Height: max(0, size.Height)}
	s.layout = prepareIndexLayout(s.size)
	s.definitions.SetSize(s.layout.list.W, max(0, s.layout.list.H-3))
	s.detail.SetSize(s.layout.detail.W, max(0, s.layout.detail.H-3))
	s.syncDetail()
}

func prepareIndexLayout(size Size) indexLayout {
	root := kit.Rect{W: size.Width, H: size.Height}
	layout := indexLayout{size: size, mode: indexLayoutNarrow, list: root, detail: root}
	if root.W < indexMinimumBodyWidth || root.H < indexMinimumBodyHeight {
		layout.mode = indexLayoutTooSmall
		return layout
	}
	const splitMinimumWidth = 80
	if root.W < splitMinimumWidth {
		return layout
	}
	listWidth := root.W * 34 / 100
	listWidth = min(44, max(30, listWidth))
	panes := kit.SplitH(root, kit.Fixed(listWidth), kit.Fill())
	layout.mode = indexLayoutSplit
	layout.list, layout.detail = panes[0], panes[1]
	return layout
}
