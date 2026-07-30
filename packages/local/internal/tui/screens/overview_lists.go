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
	snapshot := o.insightsResource.Snapshot()
	insights := o.insightRows()
	meta := appendResourceStatus(fmt.Sprintf("%d open · sorted: severity ↓", len(insights)), resourceStatus(snapshot))
	header := overviewPaneHeader(width, focusTitle("Top insights", o.focusedPanel == panelInsights), "", meta)
	hdrH := strings.Count(header, "\n") + 1

	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	if !snapshot.HasValue {
		rows := []string{" " + shell.TextMuted.Render(resourceStateMessage(snapshot.State, snapshot.Err, "insights"))}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}
	if len(insights) == 0 {
		hint := " " + shell.TextMuted.Render("No insights yet — run `crux eval`, or use your app with `crux dev` running.")
		rows := []string{hint}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}

	rows := o.insightList.Render(func(ins api.InspectInsightRecord, _ int, selected bool, rowW int) string {
		// Row: bar + severity dot + title + category + target + age + spark.
		bar := "  "
		if selected && o.focusedPanel == panelInsights {
			bar = shell.SelectionBar(shell.SeverityColor(ins.Severity)) + " "
		}
		sev := kit.SeverityDot(ins.Severity)
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

		titleBudget := rowW - 2 - 2 - 13 - 13 - 5 - skW - 4
		if titleBudget < 12 {
			titleBudget = 12
		}
		title := shell.Text.Render(padString3(kit.TruncateWords(kit.SanitizeInline(ins.Title), titleBudget, "…"), titleBudget))

		line1Parts := []string{bar, sev, " ", title, " ", tag, " ", target, " ", ago}
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
	snapshot := o.runsResource.Snapshot()
	runs := o.runRows()
	meta := appendResourceStatus(recentRunsMeta(runs), resourceStatus(snapshot))
	header := overviewPaneHeader(width, focusTitle("Recent runs", o.focusedPanel == panelRuns), "", meta)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}
	if !snapshot.HasValue {
		rows := []string{" " + shell.TextMuted.Render(resourceStateMessage(snapshot.State, snapshot.Err, "recent runs"))}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}
	rows := o.runList.Render(func(r api.InspectRunRecord, _ int, selected bool, rowW int) string {
		prefix := " "
		if selected && o.focusedPanel == panelRuns {
			prefix = shell.SelectionBar(shell.ColorTeal) + " "
		}
		dot := kit.StatusDot(r.Status)
		name := kit.SanitizeInline(firstNonEmpty(o.runNames[inspectOperationID(r)], r.TargetID, r.FlowID, r.RootPrimitive, inspectOperationID(r)))
		name = kit.TruncateMiddle(name, 24, "…")
		lat := durStr(r.DurationMs)
		tok := formatTokensShort(r.TokenCount)
		ago := relTimeUnix(r.StartedAt)
		// Single-line row leads with the human name, falling back to stable ID.
		row := fmt.Sprintf("%s%s  %s  %s · %s tok",
			prefix,
			dot,
			shell.Text.Render(padString3(name, 24)),
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
		rows = append(rows, padRow(" "+shell.TextMuted.Render("No runs yet — use your app with `crux dev` running, or run `crux eval`."), width))
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

func recentRunsMeta(runs []api.InspectRunRecord) string {
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
	count := len(runs)
	return fmt.Sprintf("%s · %d %s", window, count, kit.Pluralize(count, "run"))
}
