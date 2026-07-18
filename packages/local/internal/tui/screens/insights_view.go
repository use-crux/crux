package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (s *Insights) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading insights...")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if size.Width <= 0 || size.Height <= 0 {
		return ""
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no insights yet - collect more traces or wait for the analyzer.")
	}

	root := kit.Rect{W: size.Width, H: size.Height}
	switch kit.Classify(size.Width) {
	case kit.LayoutFull, kit.LayoutTwo:
		panes := kit.SplitH(root, kit.Ratio(2, 5), kit.Fill())
		return strings.Join(kit.ComposeStyled(panes, [][]string{
			s.renderListLines(panes[0]),
			s.renderDetailLines(panes[1]),
		}, insightsStyles), "\n")
	default:
		if s.focus == focusInsightsDetail {
			return strings.Join(s.renderDetailLines(root), "\n")
		}
		return strings.Join(s.renderListLines(root), "\n")
	}
}

func (s *Insights) renderListLines(r kit.Rect) []string {
	return blockLines(s.renderList(r.W, r.H), r)
}

func (s *Insights) renderDetailLines(r kit.Rect) []string {
	return blockLines(s.renderDetail(r.W, r.H), r)
}
