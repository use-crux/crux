package tui

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/output"
)

var bootPhaseOrder = []string{
	"Starting devtools server",
	"Waiting for HTTP ready",
	"Connecting WebSocket",
	"Loading initial data",
}

func (a *App) viewBoot() string {
	var sb strings.Builder
	sb.WriteString(headerBar.Render(strings.Join([]string{output.Logo("dev startup"), dimStyle.Render(a.serverURL)}, "  ")))
	sb.WriteString("\n\n")
	sb.WriteString(paneTitleStyle.Render(" Boot"))
	sb.WriteString("\n\n")
	currentRank := bootPhaseRank(a.bootPhase)
	for idx, phase := range bootPhaseOrder {
		prefix := dimStyle.Render("?")
		switch {
		case a.bootComplete || currentRank > idx:
			prefix = greenStyle.Render("?")
		case currentRank == idx:
			prefix = accentStyle.Render(a.spinner.View())
		}
		sb.WriteString(fmt.Sprintf("  %s %s\n", prefix, fgStyle.Render(phase)))
	}
	if a.startupMode != "" {
		sb.WriteString("\n")
		sb.WriteString(fmt.Sprintf("  %s %s\n", labelStyle.Render("Mode"), fgStyle.Render(a.startupMode)))
	}
	if len(a.bootLogs) > 0 {
		sb.WriteString("\n")
		sb.WriteString(accentStyle.Render("  Recent output"))
		sb.WriteString("\n")
		for _, line := range a.bootLogs {
			sb.WriteString("  ")
			sb.WriteString(dimStyle.Render(line))
			sb.WriteString("\n")
		}
	}
	if a.startupDebug && a.startupSummary != "" {
		sb.WriteString("\n")
		sb.WriteString(fmt.Sprintf("  %s %s\n", labelStyle.Render("Startup"), fgStyle.Render(a.startupSummary)))
	}
	sb.WriteString("\n")
	sb.WriteString(footStyle.Render(dimStyle.Render("q:quit")))
	return sb.String()
}

func (a *App) viewBootError() string {
	var sb strings.Builder
	sb.WriteString(headerBar.Render(strings.Join([]string{output.Logo("startup failed"), dimStyle.Render(a.serverURL)}, "  ")))
	sb.WriteString("\n\n")
	sb.WriteString(paneTitleStyle.Render(" Error"))
	sb.WriteString("\n\n")
	for _, line := range strings.Split(a.bootError, "\n") {
		sb.WriteString("  ")
		sb.WriteString(redStyle.Render(line))
		sb.WriteString("\n")
	}
	if len(a.bootLogs) > 0 {
		sb.WriteString("\n")
		sb.WriteString(accentStyle.Render("  Recent output"))
		sb.WriteString("\n")
		for _, line := range a.bootLogs {
			sb.WriteString("  ")
			sb.WriteString(dimStyle.Render(line))
			sb.WriteString("\n")
		}
	}
	if a.startupDebug && a.startupSummary != "" {
		sb.WriteString("\n")
		sb.WriteString(fmt.Sprintf("  %s %s\n", labelStyle.Render("Startup"), fgStyle.Render(a.startupSummary)))
	}
	sb.WriteString("\n")
	sb.WriteString(footStyle.Render(dimStyle.Render("q:quit")))
	return sb.String()
}

func bootPhaseRank(phase string) int {
	for idx, candidate := range bootPhaseOrder {
		if candidate == phase {
			return idx
		}
	}
	return 0
}
