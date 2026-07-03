package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (o *Overview) bumpRenderRev() {
	o.renderRev++
}

func (o *Overview) memoLines(focus string, rect kit.Rect, render func() string) []string {
	return o.memo.Get(kit.MemoKey{
		Revision: o.renderRev,
		Rect:     rect,
		Focus:    focus,
	}, func() []string {
		return strings.Split(render(), "\n")
	})
}

func (o *Overview) leftMemoFocus() string {
	return fmt.Sprintf("left:%d:%d:%d", o.focusedPanel, o.insightCur, o.runCur)
}

func (o *Overview) rightMemoFocus() string {
	return fmt.Sprintf("right:%d:%d", o.focusedPanel, o.activityScroll)
}
