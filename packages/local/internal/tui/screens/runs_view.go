package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func (s *Runs) View(size Size) string {
	listSnapshot := s.runsResource.Snapshot()
	if !listSnapshot.HasValue {
		if listSnapshot.State == resource.ResourceFailed && listSnapshot.Err != nil {
			return centerMsg(size, "error: "+listSnapshot.Err.Error())
		}
		return centerMsg(size, "loading runs…")
	}
	if size.Width <= 0 || size.Height <= 0 {
		return ""
	}

	root := kit.Rect{W: size.Width, H: size.Height}
	switch kit.Classify(size.Width) {
	case kit.LayoutFull:
		panes := kit.SplitH(root, kit.Fixed(26), kit.Fill(), kit.Min(34))
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			s.renderWaterfallLines(panes[1]),
			s.renderSpanDetailLines(panes[2]),
		}, runsStyles), "\n")
	case kit.LayoutTwo:
		panes := kit.SplitH(root, kit.Fixed(26), kit.Fill())
		right := s.renderWaterfallLines(panes[1])
		if s.focus == focusSpanDetail {
			right = s.renderSpanDetailLines(panes[1])
		}
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			right,
		}, runsStyles), "\n")
	default:
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
