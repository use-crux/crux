package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

var bootPhaseOrder = []string{
	"Starting devtools server",
	"Waiting for HTTP ready",
	"Connecting WebSocket",
	"Loading initial data",
}

var bootStyles = theme.NewStyles(tuiPalette)

func (a *App) viewBoot() string {
	return a.renderBootSurface("dev startup", "Boot", a.bootPhaseRows())
}

func (a *App) viewBootError() string {
	rows := make([]string, 0, 8)
	for _, line := range strings.Split(a.bootError, "\n") {
		rows = append(rows, bootStyles.Red.Render(strings.TrimSpace(line)))
	}
	return a.renderBootSurface("startup failed", "Error", rows)
}

func (a *App) bootPhaseRows() []string {
	rows := make([]string, 0, len(bootPhaseOrder)+6)
	currentRank := bootPhaseRank(a.bootPhase)
	for idx, phase := range bootPhaseOrder {
		prefix := bootStyles.Dim.Render("○")
		switch {
		case a.bootComplete || currentRank > idx:
			prefix = bootStyles.Green.Render("●")
		case currentRank == idx:
			prefix = bootStyles.Accent.Render(a.spinner.View())
		}
		rows = append(rows, fmt.Sprintf("%s %s", prefix, bootStyles.Regular.Render(phase)))
	}
	if a.startupMode != "" {
		rows = append(rows, "", bootStyles.Dim.Render("Mode")+" "+bootStyles.Regular.Render(a.startupMode))
	}
	return rows
}

func (a *App) renderBootSurface(brand, title string, rows []string) string {
	width := a.width
	if width <= 0 {
		width = 80
	}
	height := a.height
	if height <= 0 {
		height = 24
	}
	contentW := width - 4
	if contentW < 12 {
		contentW = width
	}

	lines := make([]string, 0, height)
	lines = append(lines, bootLine(output.Logo(brand)+"  "+bootStyles.Dim.Render(a.serverURL), width))
	lines = append(lines, "")
	lines = append(lines, bootLine(bootStyles.AccentHeader.Render(title), width))
	lines = append(lines, "")
	for _, row := range rows {
		lines = append(lines, bootLine("  "+row, width))
	}
	if len(a.bootLogs) > 0 {
		lines = append(lines, "", bootLine(bootStyles.Accent.Render("  Recent output"), width))
		for _, line := range a.bootLogs {
			lines = append(lines, bootLine("  "+bootStyles.Dim.Render(line), width))
		}
	}
	if a.startupDebug && a.startupSummary != "" {
		lines = append(lines, "", bootLine("  "+bootStyles.Dim.Render("Startup")+" "+bootStyles.Regular.Render(a.startupSummary), width))
	}
	lines = append(lines, "", bootLine(bootStyles.Dim.Render("q quit"), width))
	if len(lines) > height {
		lines = lines[:height]
	}
	return strings.Join(lines, "\n")
}

func bootLine(line string, width int) string {
	if width <= 0 {
		return ""
	}
	if lipgloss.Width(line) > width {
		line = kit.Truncate(line, width, "…")
	}
	return line
}

func bootPhaseRank(phase string) int {
	for idx, candidate := range bootPhaseOrder {
		if candidate == phase {
			return idx
		}
	}
	return 0
}
