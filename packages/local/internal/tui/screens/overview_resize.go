package screens

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

// Resize distributes the concrete Workbench body rectangle to Overview's
// stateful list panes before the next input event.
func (o *Overview) Resize(size Size) {
	o.size = Size{Width: max(0, size.Width), Height: max(0, size.Height)}
	insights, runs := overviewListRects(o.size)
	o.insightList.SetSize(insights.W, max(0, insights.H-3))
	o.runList.SetSize(runs.W, max(0, runs.H-3))
	o.activityPage = overviewActivityPageSize(o.size)
}

func overviewListRects(size Size) (kit.Rect, kit.Rect) {
	root := kit.Rect{W: size.Width, H: size.Height}
	if kit.Classify(size.Width) == kit.LayoutSingle {
		body := kit.Rect{W: root.W, H: max(1, root.H-8)}
		return body, body
	}
	rows := kit.SplitV(root, kit.Fixed(5), kit.Fill())
	body := rows[1]
	cols := kit.SplitH(kit.Rect{W: body.W, H: body.H}, kit.Ratio(3, 5), kit.Fill())
	left := cols[0]
	insightsH := left.H * 54 / 100
	if insightsH > 16 {
		insightsH = 16
	}
	if insightsH < 10 {
		insightsH = 10
	}
	runsH := max(1, left.H-insightsH-1)
	return kit.Rect{W: left.W, H: insightsH}, kit.Rect{W: left.W, H: runsH}
}

func overviewActivityPageSize(size Size) int {
	if kit.Classify(size.Width) == kit.LayoutSingle {
		return max(1, size.Height-10)
	}
	bodyHeight := max(0, size.Height-5)
	chartHeight := 11
	if chartHeight > bodyHeight/2 {
		chartHeight = bodyHeight / 2
	}
	activityHeight := max(0, bodyHeight-chartHeight-1)
	return max(1, activityHeight-3)
}
