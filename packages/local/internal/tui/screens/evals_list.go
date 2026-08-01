package screens

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Evals) renderListLines(rect kit.Rect) []string {
	return blockLines(s.renderList(rect.W, rect.H), rect)
}

func (s *Evals) renderList(width, height int) string {
	snapshot := s.catalogResource.Snapshot()
	meta := appendResourceStatus(evalsListPosition(s.catalog.Position()), resourceStatus(snapshot))
	subtitle := fmt.Sprintf("%d discovered", len(s.items))
	if snapshot.Refreshing {
		subtitle = fmt.Sprintf("refresh %s/30s", s.catalogElapsed.Round(time.Second))
	}
	header := overviewPaneHeader(
		width,
		focusTitle("Eval catalog", s.focus == evalsFocusCatalog),
		subtitle,
		meta,
	)
	headerHeight := strings.Count(header, "\n") + 1
	rows := s.catalog.Render(func(item evalCatalogItem, _ int, selected bool, rowWidth int) string {
		return s.renderCatalogRow(item, rowWidth, selected && s.focus == evalsFocusCatalog)
	})
	lines := []string{header}
	lines = append(lines, rows...)
	for len(lines)-headerHeight < height-headerHeight {
		lines = append(lines, strings.Repeat(" ", width))
	}
	return strings.Join(lines[:min(len(lines), height-headerHeight+1)], "\n")
}

func (s *Evals) renderCatalogRow(item evalCatalogItem, width int, selected bool) string {
	prefix := "  "
	if selected {
		prefix = shell.SelectionBar(shell.ColorTeal) + " "
	}
	status, tone := s.catalogArmStatus(item)
	line1 := prefix + shell.Text.Render(sanitizeEvals(item.ID)) + "  " +
		lipgloss.NewStyle().Foreground(tone).Render(status)

	baseline := s.baselineForEval(item.ID)
	meta := fmt.Sprintf("%d×%d", len(item.CaseIDs), len(item.VariantIDs))
	if baseline.SelectedArm != "" {
		meta += " · baseline " + sanitizeEvals(baseline.SelectedArm)
	}
	line2 := "   " + shell.TextDim.Render(meta)

	readiness := firstNonEmpty(item.HostStatus, "readiness unknown")
	if !evalHostReady(item.HostStatus) && item.HostRemedy != "" {
		readiness += " · " + item.HostRemedy
	}
	line3 := "   " + shell.TextDim.Render(sanitizeEvals(readiness))
	line4 := "   " + shell.TextMuted.Render(sanitizeEvals(item.SourceFile))
	return strings.Join([]string{
		padRow(line1, width), padRow(line2, width), padRow(line3, width), padRow(line4, width),
	}, "\n")
}

func (s *Evals) catalogArmStatus(item evalCatalogItem) (string, color.Color) {
	history := s.historyForEval(item.ID)
	if len(history) == 0 {
		return "◌ not-run", shell.ColorTextDim
	}
	latest := history[0]
	if item.DefinitionFingerprint != "" && latest.DefinitionFingerprint != "" &&
		item.DefinitionFingerprint != latest.DefinitionFingerprint {
		return "◇ stale", shell.ColorAmber
	}
	arm := "current"
	if _, exists := latest.Aggregates[arm]; !exists && len(latest.Variants) > 0 {
		arm = latest.Variants[0]
	}
	aggregate, ok := latest.Aggregates[arm]
	if !ok || aggregate.Cells == 0 {
		return "◌ not-run", shell.ColorTextDim
	}
	if aggregate.Failed > 0 {
		return "■ failed", shell.ColorRose
	}
	if aggregate.Passed > 0 {
		return "■ passed", shell.ColorGreen
	}
	return "◌ not-run", shell.ColorTextDim
}

func (s *Evals) baselineForEval(evalID string) evalBaselineItem {
	for _, baseline := range s.baselines {
		if baseline.EvalID == evalID {
			return baseline
		}
	}
	return evalBaselineItem{}
}

func evalHostReady(status string) bool {
	switch status {
	case "ready", "available", "ok":
		return true
	default:
		return false
	}
}

func evalsListPosition(position kit.ListPosition) string {
	if position.Total == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d/%d", position.SelectedIndex+1, position.Total)
}
