package screens

import (
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (s *Runs) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading runs…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
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
	return s.memoLines(s.listMemoFocus(), r, func() string {
		return s.renderList(r.W, r.H)
	})
}

func (s *Runs) renderWaterfallLines(r kit.Rect) []string {
	return s.memoLines(s.waterfallMemoFocus(), r, func() string {
		return s.renderWaterfall(r.W, r.H)
	})
}

func (s *Runs) renderSpanDetailLines(r kit.Rect) []string {
	return s.memoLines(s.detailMemoFocus(), r, func() string {
		return s.renderSpanDetail(r.W, r.H)
	})
}

func blockLines(body string, r kit.Rect) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	return strings.Split(kit.PadBlock(body, r.W, r.H), "\n")
}

func (s *Runs) bumpRenderRev() {
	s.renderRev++
}

func (s *Runs) memoLines(focus string, rect kit.Rect, render func() string) []string {
	return s.memo.Get(kit.MemoKey{
		Revision: s.renderRev,
		Rect:     rect,
		Focus:    focus,
	}, func() []string {
		return blockLines(render(), rect)
	})
}

func (s *Runs) listMemoFocus() string {
	return fmt.Sprintf("list:%s:%d:%t:%s:%d", s.selRun, s.focus, s.filteringRuns, s.runQuery, s.runStatusIndex)
}

func (s *Runs) waterfallMemoFocus() string {
	return fmt.Sprintf("waterfall:%s:%s:%d:%s", s.selRun, s.selSpan, s.focus, s.expandedSignature())
}

func (s *Runs) detailMemoFocus() string {
	return fmt.Sprintf("detail:%s:%s:%d", s.selRun, s.selSpan, s.focus)
}

func (s *Runs) expandedSignature() string {
	if len(s.expandedDups) == 0 {
		return ""
	}
	keys := make([]string, 0, len(s.expandedDups))
	for key, expanded := range s.expandedDups {
		if expanded {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}
