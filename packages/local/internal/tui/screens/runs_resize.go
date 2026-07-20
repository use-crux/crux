package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

const (
	runsMinimumBodyWidth  = 60
	runsMinimumBodyHeight = 17

	// runsMinimumTerminalLabel is the user-facing terminal contract matching
	// the body minimum with the Workbench's current chrome. Layout decisions
	// remain based solely on the received body rectangle.
	runsMinimumTerminalLabel = "60×20"
)

// Resize distributes the concrete screen body size to Runs' stateful panes.
// Workbench calls it before input, so navigation never depends on a prior
// render pass.
func (s *Runs) Resize(size Size) {
	s.size = Size{Width: max(0, size.Width), Height: max(0, size.Height)}
	s.layout = prepareRunsLayout(s.size)
	s.runList.SetSize(s.layout.list.W, max(0, s.layout.list.H-3))
	s.syncSpanRows()
	s.spanList.SetSize(s.layout.evidence.W, s.waterfallSpanHeight(s.layout.evidence.W, s.layout.evidence.H))
	s.resizeSpanDocument(s.layout.detail)
}

type runsLayoutMode uint8

const (
	runsLayoutTooSmall runsLayoutMode = iota
	runsLayoutNarrow
	runsLayoutMedium
	runsLayoutWide
)

type runsLayout struct {
	size     Size
	mode     runsLayoutMode
	list     kit.Rect
	evidence kit.Rect
	detail   kit.Rect
}

func prepareRunsLayout(size Size) runsLayout {
	root := kit.Rect{W: size.Width, H: size.Height}
	layout := runsLayout{size: size, mode: runsLayoutNarrow, list: root, evidence: root, detail: root}
	const (
		listWidth        = 26
		evidenceMinWidth = 44
		detailMinWidth   = 34
	)
	if root.W < runsMinimumBodyWidth || root.H < runsMinimumBodyHeight {
		layout.mode = runsLayoutTooSmall
		return layout
	}
	if root.W >= listWidth+evidenceMinWidth+detailMinWidth+2 {
		panes := kit.SplitH(root, kit.Fixed(listWidth), kit.Fill(), kit.Min(detailMinWidth))
		layout.mode = runsLayoutWide
		layout.list, layout.evidence, layout.detail = panes[0], panes[1], panes[2]
		return layout
	}
	if root.W >= listWidth+evidenceMinWidth+1 {
		panes := kit.SplitH(root, kit.Fixed(listWidth), kit.Fill())
		layout.mode = runsLayoutMedium
		layout.list, layout.evidence, layout.detail = panes[0], panes[1], panes[1]
	}
	return layout
}

func (s *Runs) resizeSpanDocument(rect kit.Rect) {
	headerHeight := strings.Count(s.spanDetailHeader(rect.W, rect.H), "\n") + 1
	s.spanDocument.SetSize(rect.W, max(0, rect.H-headerHeight))
	s.spanDocument.SetFocused(s.focus == focusSpanDetail)
	span := s.currentSpan()
	if span == nil {
		if s.diagnosis == nil {
			s.spanDocument.SetContent("", "")
			return
		}
		s.spanDocument.SetContent(s.SelectedRunID()+":diagnosis", renderDiagnosisOverview(s.diagnosis, rect.W))
		return
	}
	s.spanDocument.SetContent(s.SelectedRunID()+":"+span.ID, s.renderSpanDetailDocument(span, rect.W))
}
