package screens

import (
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (o *Overview) renderLeftColumn(width, height int) string {
	insightsH := height * 54 / 100
	if insightsH > 16 {
		insightsH = 16
	}
	if insightsH < 10 {
		insightsH = 10
	}
	runsH := height - insightsH - 1
	insights := o.renderInsightsBlock(width, insightsH)
	runs := o.renderRecentRunsBlock(width, runsH)
	// No explicit divider between the two sub-panes — PaneHeader now
	// owns top + bottom borders, so the "Recent runs" header brings
	// its own separator. Inserting one here would double up the rule.
	return insights + "\n" + runs
}

func (o *Overview) renderInsightsBlock(width, height int) string {
	header := shell.PaneHeader(width, "Top insights", "",
		shell.TextMuted.Render(fmt.Sprintf("%d open · sorted: severity ↓", len(o.insights))))
	hdrH := strings.Count(header, "\n") + 1

	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	if len(o.insights) == 0 {
		hint := " " + shell.TextMuted.Render("no insights yet — run an experiment or wait for the analyzer.")
		rows := []string{hint}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}

	o.insightList.SetItems(o.insights)
	o.insightList.SetHeight(bodyRows)
	o.insightList.SetCursorByIdentity(o.SelectedInsightID())
	rows := o.insightList.Render(width, func(ins api.QualityInsightRecord, _ int, selected bool, rowW int) string {
		// Row 1: bar + severity dot + ID + tag chip + title + target + age.
		bar := "  "
		if selected {
			bar = shell.SelectionBar(shell.SeverityColor(ins.Severity)) + " "
		}
		sev := kit.SeverityDot(ins.Severity)
		id := shell.TextMuted.Render(padString3(truncate(ins.InsightID, 7), 7))
		tag := ""
		if len(ins.Tags) > 0 {
			tag = shell.Teal.Render(padString3(truncate(ins.Tags[0], 12), 12))
		} else {
			tag = strings.Repeat(" ", 12)
		}
		target := shell.TextDim.Render(padString3(truncate(ins.TargetID, 12), 12))
		ago := shell.TextMuted.Render(padString3(relTime(ins.UpdatedAt), 4))

		// Sparkline column on the right; trim title accordingly.
		sk := ""
		if len(ins.Trend) > 0 {
			sk = kit.Sparkline(ins.Trend, 6, shell.SeverityColor(ins.Severity))
		}
		skW := lipgloss.Width(sk)

		titleBudget := rowW - 8 - 7 - 13 - 13 - 5 - skW - 6
		if titleBudget < 12 {
			titleBudget = 12
		}
		title := shell.Text.Render(padString3(truncate(ins.Title, titleBudget), titleBudget))

		line1Parts := []string{bar, sev, " ", id, " ", tag, " ", title, " ", target, " ", ago}
		if sk != "" {
			line1Parts = append(line1Parts, "  ", sk)
		}
		line1 := strings.Join(line1Parts, "")

		return padRow(line1, rowW)
	})
	for len(rows) < bodyRows {
		rows = append(rows, strings.Repeat(" ", width))
	}
	return header + "\n" + strings.Join(rows, "\n")
}

func (o *Overview) renderRecentRunsBlock(width, height int) string {
	runs := o.overview.RecentRuns
	if len(runs) == 0 {
		runs = o.runs
	}
	header := shell.PaneHeader(width, "Recent runs", "",
		shell.TextMuted.Render(recentRunsMeta(runs)))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}
	o.runList.SetItems(runs)
	o.runList.SetHeight(bodyRows)
	o.runList.SetCursorByIdentity(o.SelectedRunID())
	rows := o.runList.Render(width, func(r api.QualityRunRecord, _ int, selected bool, rowW int) string {
		prefix := " "
		if selected && o.focusedPanel == panelRuns {
			prefix = shell.SelectionBar(shell.ColorTeal) + " "
		}
		dot := kit.StatusDot(r.Status)
		id := shortID(r.TraceID, 7)
		target := truncate(r.TargetID, 14)
		lat := durStr(r.DurationMs)
		tok := formatTokensShort(r.TokenCount)
		ago := relTimeUnix(r.StartedAt)
		// Single-line row matching the design's run/<id> <target> <lat>·<tok> tok … <ago>
		row := fmt.Sprintf("%s%s  %s  %s   %s · %s tok",
			prefix,
			dot,
			shell.Text.Render(padString3("run/"+id, 16)),
			shell.TextDim.Render(padString3(target, 14)),
			shell.TextDim.Render(padString3(lat, 7)),
			shell.TextDim.Render(padString3(tok, 6)),
		)
		// Right-align age.
		rightStr := shell.TextMuted.Render(ago)
		used := lipgloss.Width(row)
		pad := rowW - used - lipgloss.Width(rightStr) - 1
		if pad < 1 {
			pad = 1
		}
		row = row + strings.Repeat(" ", pad) + rightStr + " "
		return padRow(row, rowW)
	})
	if len(runs) == 0 {
		rows = append(rows, " "+shell.TextMuted.Render("no runs yet — start a flow or prompt to see traces here."))
	}
	for len(rows) < bodyRows {
		rows = append(rows, strings.Repeat(" ", width))
	}
	return header + "\n" + strings.Join(rows, "\n")
}

func padString3(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func panelRect(body string, width, height int) string {
	return kit.PadBlock(body, width, height)
}

func recentRunsMeta(runs []api.QualityRunRecord) string {
	if len(runs) == 0 {
		return "no runs"
	}
	newest := int64(0)
	oldest := int64(0)
	for _, r := range runs {
		if r.StartedAt == 0 {
			continue
		}
		if newest == 0 || r.StartedAt > newest {
			newest = r.StartedAt
		}
		if oldest == 0 || r.StartedAt < oldest {
			oldest = r.StartedAt
		}
	}
	window := "recent"
	if newest > 0 && oldest > 0 {
		d := time.UnixMilli(newest).Sub(time.UnixMilli(oldest))
		switch {
		case d < time.Hour:
			window = "last 1h"
		case d < 24*time.Hour:
			window = fmt.Sprintf("last %dh", int(d.Hours())+1)
		default:
			window = fmt.Sprintf("last %dd", int(d.Hours()/24)+1)
		}
	}
	return fmt.Sprintf("%s · %d runs", window, len(runs))
}
