package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func sampleCassette() api.QualityCassetteRecord {
	return api.QualityCassetteRecord{
		Path: "fixtures/triage.cassette",
	}
}

// TestCassettesPlayEmitsCmd asserts pressing `p` (Cassettes exception
// per KEYBINDS — "play once" not "promote") returns a non-nil cmd that
// will call c.PlayCassetteOnce once the backend lands.
func TestCassettesPlayEmitsCmd(t *testing.T) {
	c := NewCassettes()
	c.items = []api.QualityCassetteRecord{sampleCassette()}
	c.selectedPath = "fixtures/triage.cassette"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}, nil)
	if cmd == nil {
		t.Error("pressing `p` returned nil; expected play stub")
	}
}

// TestCassettesReRecordEmitsCmd asserts uppercase `R` (destructive
// per KEYBINDS) returns a non-nil cmd that will overwrite the
// cassette via c.ReRecordCassette.
func TestCassettesReRecordEmitsCmd(t *testing.T) {
	c := NewCassettes()
	c.items = []api.QualityCassetteRecord{sampleCassette()}
	c.selectedPath = "fixtures/triage.cassette"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'R'}}, nil)
	if cmd == nil {
		t.Error("pressing `R` returned nil; expected re-record stub")
	}
}

// TestCassettesPruneEmitsCmd asserts `x` (= dismiss-shaped) returns a
// non-nil cmd that will call c.PruneMissingCassetteEntries.
func TestCassettesPruneEmitsCmd(t *testing.T) {
	c := NewCassettes()
	c.items = []api.QualityCassetteRecord{sampleCassette()}
	c.selectedPath = "fixtures/triage.cassette"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}}, nil)
	if cmd == nil {
		t.Error("pressing `x` returned nil; expected prune stub")
	}
}

// TestCassettesDiffEmitsCmd asserts `d` (diff vs main, screen-local
// Layer 3) returns a non-nil cmd.
func TestCassettesDiffEmitsCmd(t *testing.T) {
	c := NewCassettes()
	c.items = []api.QualityCassetteRecord{sampleCassette()}
	c.selectedPath = "fixtures/triage.cassette"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'d'}}, nil)
	if cmd == nil {
		t.Error("pressing `d` returned nil; expected diff stub")
	}
}
