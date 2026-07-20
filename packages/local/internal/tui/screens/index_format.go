package screens

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// indexKindGlyph returns the compact visual identity for a definition kind.
func indexKindGlyph(kind string) string {
	switch kind {
	case "prompt":
		return shell.Teal.Render("⌬")
	case "context":
		return shell.Teal.Render("≣")
	case "tool":
		return shell.Teal.Render("⚒")
	case "agent":
		return shell.Teal.Render("◆")
	case "flow":
		return shell.Teal.Render("⇄")
	case "flow.step":
		return shell.Teal.Render("↳")
	case "composition.parallel", "composition.parallel.branch":
		return shell.Teal.Render("∥")
	case "composition.pipeline", "composition.pipeline.stage":
		return shell.Teal.Render("▸")
	case "composition.consensus":
		return shell.Teal.Render("◎")
	case "composition.swarm":
		return shell.Teal.Render("✦")
	case "memory", "memory.block", "memory.store", "blackboard":
		return shell.Teal.Render("▣")
	case "rag.pipeline", "rag.pipeline.stage", "rag.retriever":
		return shell.Teal.Render("⌁")
	case "eval", "eval.case":
		return shell.Teal.Render("✓")
	default:
		return shell.TextMuted.Render("·")
	}
}

func indexFidelityChip(fidelity string) string {
	fidelity = sanitizeIndexInline(fidelity)
	switch fidelity {
	case "partial":
		return kit.ChipState("partial", shell.ColorAmber)
	case "error":
		return kit.ChipState("error", shell.ColorRose)
	default:
		return kit.ChipTag(fidelity)
	}
}

// clipIDs joins IDs with a compact separator and clips them to width.
func clipIDs(ids []string, width int) string {
	safe := make([]string, len(ids))
	for index, id := range ids {
		safe[index] = sanitizeIndexInline(id)
	}
	joined := strings.Join(safe, " · ")
	if lipgloss.Width(joined) <= width {
		return joined
	}
	return truncate(joined, width)
}
