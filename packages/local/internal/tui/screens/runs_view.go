package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func (s *Runs) View(_ Size) string {
	if s.layout.size.Width <= 0 || s.layout.size.Height <= 0 {
		return ""
	}
	if s.layout.mode == runsLayoutTooSmall {
		return centerMsg(s.layout.size, "terminal too small — resize to at least "+runsMinimumTerminalLabel)
	}
	listSnapshot := s.runsResource.Snapshot()
	if !listSnapshot.HasValue {
		if listSnapshot.State == resource.ResourceFailed && listSnapshot.Err != nil {
			return centerMsg(s.layout.size, truncateRunsInline("error: "+listSnapshot.Err.Error(), s.layout.size.Width))
		}
		return centerMsg(s.layout.size, "loading runs…")
	}

	switch s.layout.mode {
	case runsLayoutWide:
		panes := []kit.Rect{s.layout.list, s.layout.evidence, s.layout.detail}
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			s.renderWaterfallLines(panes[1]),
			s.renderSpanDetailLines(panes[2]),
		}, runsStyles), "\n")
	case runsLayoutMedium:
		panes := []kit.Rect{s.layout.list, s.layout.evidence}
		right := s.renderWaterfallLines(panes[1])
		if s.diagnosis != nil && s.focus != focusWaterfall {
			right = s.renderSpanDetailLines(panes[1])
		}
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			right,
		}, runsStyles), "\n")
	default:
		root := s.layout.list
		switch s.focus {
		case focusWaterfall:
			return strings.Join(s.renderWaterfallLines(root), "\n")
		case focusSpanDetail:
			return strings.Join(s.renderSpanDetailLines(root), "\n")
		default:
			return strings.Join(s.renderListLines(root), "\n")
		}
	}
}

func (s *Runs) renderListLines(r kit.Rect) []string {
	return blockLines(s.renderList(r.W, r.H), r)
}

func (s *Runs) renderWaterfallLines(r kit.Rect) []string {
	return blockLines(s.renderWaterfall(r.W, r.H), r)
}

func (s *Runs) renderSpanDetailLines(r kit.Rect) []string {
	return blockLines(s.renderSpanDetail(r.W, r.H), r)
}

func blockLines(body string, r kit.Rect) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	return strings.Split(kit.PadBlock(body, r.W, r.H), "\n")
}
