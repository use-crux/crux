package screens

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

// Resize distributes the concrete screen body size to Runs' stateful panes.
// Workbench calls it before input, so navigation never depends on a prior
// render pass.
func (s *Runs) Resize(size Size) {
	s.size = Size{Width: max(0, size.Width), Height: max(0, size.Height)}
	listRect, documentRect := runsPaneRects(s.size)
	s.runList.SetSize(listRect.W, max(0, listRect.H-3))
	s.resizeSpanDocument(documentRect)
}

func runsPaneRects(size Size) (list, document kit.Rect) {
	root := kit.Rect{W: size.Width, H: size.Height}
	switch kit.Classify(size.Width) {
	case kit.LayoutFull:
		panes := kit.SplitH(root, kit.Fixed(26), kit.Fill(), kit.Min(34))
		return panes[0], panes[2]
	case kit.LayoutTwo:
		panes := kit.SplitH(root, kit.Fixed(26), kit.Fill())
		return panes[0], panes[1]
	default:
		return root, root
	}
}

func (s *Runs) resizeSpanDocument(rect kit.Rect) {
	s.spanDocument.SetSize(rect.W, max(0, rect.H-3))
	s.spanDocument.SetFocused(s.focus == focusSpanDetail)
	if s.detail == nil || len(s.detail.Spans) == 0 {
		s.spanDocument.SetContent("", "")
		return
	}
	span := s.currentSpan()
	if span == nil {
		span = &s.detail.Spans[0]
	}
	s.spanDocument.SetContent(s.SelectedRunID()+":"+span.ID, s.renderSpanDetailDocument(span, rect.W))
}
