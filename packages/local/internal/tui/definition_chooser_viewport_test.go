package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

func TestDefinitionChooserMakesCompleteLongIDAndEveryMetadataReferenceViewable(t *testing.T) {
	longID := "agent:" + strings.Repeat("exact-identifier-segment-", 8)
	references := make([]observability.DefinitionRef, 40)
	for index := range references {
		references[index] = observability.DefinitionRef{
			ID: longID, Kind: "agent", Role: fmt.Sprintf("role-%02d", index+1),
			Source: &observability.SanitizedSourceRef{File: fmt.Sprintf("src/metadata-source-%02d.ts", index+1), Line: index + 1},
		}
	}
	chooser := newDefinitionChooser()
	chooser.Resize(70, 24)
	chooser.Open([]screens.DefinitionChoice{{ID: longID, References: references}})
	chooser.Update(tea.KeyPressMsg{Code: tea.KeyTab})

	seen := make(map[string]bool, len(references))
	for page := 0; page < 80; page++ {
		frame := ansi.Strip(overlayOnto(kit.PadBlock("", 70, 24), chooser.View(), 70, 24))
		assertTerminalFrameGeometry(t, frame, 70, 24)
		lines := strings.Split(frame, "\n")
		border := ""
		for _, line := range lines {
			if strings.Contains(line, "╭") {
				border = strings.TrimLeft(line, " ")
				break
			}
		}
		if !strings.HasPrefix(border, "╭") || !strings.HasSuffix(border, "╮") {
			t.Fatalf("chooser border clipped at 70 columns:\n%q", border)
		}
		for index := range references {
			if strings.Contains(frame, fmt.Sprintf("metadata-source-%02d.ts", index+1)) {
				seen[fmt.Sprintf("source-%02d", index+1)] = true
			}
		}
		if page == 0 {
			for _, fragment := range []string{"agent:exact-identifier", "identifier-segment"} {
				if !strings.Contains(frame, fragment) {
					t.Fatalf("long exact ID fragment %q not viewable:\n%s", fragment, frame)
				}
			}
		}
		chooser.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	}
	if len(seen) != len(references) {
		t.Fatalf("viewable metadata sources = %d, want all %d", len(seen), len(references))
	}
}

func TestDefinitionChooserBoundsOneChoiceWithManyMetadataRowsAt70x24(t *testing.T) {
	references := make([]observability.DefinitionRef, 40)
	for index := range references {
		references[index] = observability.DefinitionRef{
			ID: "agent:many-metadata", Kind: "agent", Role: fmt.Sprintf("role-%02d", index+1),
			Source: &observability.SanitizedSourceRef{File: fmt.Sprintf("src/metadata-%02d.ts", index+1), Line: index + 1},
		}
	}
	chooser := newDefinitionChooser()
	chooser.Resize(70, 24)
	chooser.Open([]screens.DefinitionChoice{
		{ID: "agent:many-metadata", References: references},
		{ID: "prompt:next-choice", References: []observability.DefinitionRef{{ID: "prompt:next-choice", Kind: "prompt", Role: "resolve"}}},
	})
	frame := overlayOnto(kit.PadBlock("", 70, 24), chooser.View(), 70, 24)
	assertTerminalFrameGeometry(t, ansi.Strip(frame), 70, 24)

	chooser.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	if got := chooser.SelectedID(); got != "prompt:next-choice" {
		t.Fatalf("page down from oversized metadata row selected %q", got)
	}
	frame = overlayOnto(kit.PadBlock("", 70, 24), chooser.View(), 70, 24)
	assertTerminalFrameGeometry(t, ansi.Strip(frame), 70, 24)
}
