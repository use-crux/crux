package overlays

import (
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestPaletteTextInputUsesKeyText(t *testing.T) {
	p := NewPalette()
	p.Open()

	p.Update(tea.KeyPressMsg{Text: "save"})
	p.Update(tea.KeyPressMsg{Code: tea.KeySpace, Text: " "})
	p.Update(tea.KeyPressMsg{Text: "case"})

	if p.input != "save case" {
		t.Fatalf("palette input = %q, want %q", p.input, "save case")
	}
}

func TestHelpFilterUsesKeyText(t *testing.T) {
	h := NewHelp()
	h.Open()

	h.Update(tea.KeyPressMsg{Text: "run"})
	h.Update(tea.KeyPressMsg{Code: tea.KeySpace, Text: " "})
	h.Update(tea.KeyPressMsg{Text: "trace"})

	if h.filter != "run trace" {
		t.Fatalf("help filter = %q, want %q", h.filter, "run trace")
	}
}
