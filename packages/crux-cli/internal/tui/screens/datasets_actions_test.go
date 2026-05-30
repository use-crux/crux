package screens

import (
	"testing"

	"github.com/anthropics/crux-cli/internal/api"
	tea "github.com/charmbracelet/bubbletea"
)

func sampleSuite() api.QualitySuiteRecord {
	return api.QualitySuiteRecord{
		SuiteID: "rfp-gold",
		Name:    "RFP Gold",
		Cases: []api.QualitySuiteCase{
			{CaseID: "case-001", Tags: []string{"docs"}},
		},
	}
}

// TestSuitesEKeyExportsNotEdits asserts pressing `e` on Suites exports
// the focused suite rather than opening the case editor. Per
// KEYBINDS.md `e` is the Layer-2 export verb across screens; editing
// a case uses `i` (vim-ish) or `↵`. The legacy `e edit` triggered
// edit mode — that violated the contract.
func TestSuitesEKeyExportsNotEdits(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{sampleSuite()}
	d.selectedID = "rfp-gold"
	d.selectedCase = "case-001"

	cmd := d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if d.Editing() {
		t.Error("pressing `e` entered edit mode; should have triggered export instead")
	}
	if cmd == nil {
		t.Error("pressing `e` returned nil cmd; expected export emitter")
	}
}

// TestSuitesIKeyStillEditsCase asserts `i` (vim insert) still opens
// the case editor — that's the canonical edit-entry chord.
func TestSuitesIKeyStillEditsCase(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{sampleSuite()}
	d.selectedID = "rfp-gold"
	d.selectedCase = "case-001"

	d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'i'}}, nil)
	if !d.Editing() {
		t.Error("pressing `i` did not enter edit mode")
	}
}

// TestSuitesNKeyCreatesDraftCaseAndEdits asserts pressing `n` while
// browsing creates a fresh draft case in the focused suite, selects
// it, and enters edit mode pointed at the new case. The case-list
// length grows by one.
func TestSuitesNKeyCreatesDraftCaseAndEdits(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{sampleSuite()}
	d.selectedID = "rfp-gold"
	d.selectedCase = "case-001"

	startCount := len(d.items[0].Cases)
	d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}}, nil)

	if len(d.items[0].Cases) != startCount+1 {
		t.Errorf("case count = %d, want %d (one new draft)", len(d.items[0].Cases), startCount+1)
	}
	if !d.Editing() {
		t.Error("pressing `n` should enter edit mode targeting the new draft")
	}
	if d.selectedCase == "case-001" {
		t.Errorf("selectedCase was not advanced to the new draft; still %q", d.selectedCase)
	}
}

// TestSuitesNKeyNoopWithoutFocusedSuite asserts `n` is a no-op when no
// suite is focused (e.g. when items is empty).
func TestSuitesNKeyNoopWithoutFocusedSuite(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	// no items

	d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}}, nil)
	if d.Editing() {
		t.Error("pressing `n` with no focused suite entered edit mode; expected no-op")
	}
}

// TestSuitesXKeyRemovesFocusedCaseLocally asserts pressing `x` removes
// the focused case from the in-memory case list (optimistic update)
// and returns a non-nil tea.Cmd that calls `c.DeleteSuiteCase` when
// that backend method lands (currently a stub that emits a "backend
// pending" message). Lowercase x because the case can be re-added.
func TestSuitesXKeyRemovesFocusedCaseLocally(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{
		{
			SuiteID: "rfp-gold",
			Cases: []api.QualitySuiteCase{
				{CaseID: "case-001"},
				{CaseID: "case-002"},
			},
		},
	}
	d.selectedID = "rfp-gold"
	d.selectedCase = "case-001"

	cmd := d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}}, nil)
	if cmd == nil {
		t.Error("pressing `x` returned nil; expected DeleteSuiteCase cmd (or stub)")
	}
	// Local list got pruned optimistically.
	for _, kase := range d.items[0].Cases {
		if kase.CaseID == "case-001" {
			t.Error("focused case was not removed from local list")
		}
	}
	// Selection slid to the next available case.
	if d.selectedCase == "case-001" {
		t.Errorf("selectedCase still points to removed case; got %q", d.selectedCase)
	}
}

// TestSuitesDeleteSuiteKeyEmitsCmd asserts uppercase `D` (destructive)
// emits a non-nil tea.Cmd that will call c.DeleteSuite once that
// backend method exists. V1 returns a stub cmd so the keystroke
// produces an observable effect.
func TestSuitesDeleteSuiteKeyEmitsCmd(t *testing.T) {
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{sampleSuite()}
	d.selectedID = "rfp-gold"

	cmd := d.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'D'}}, nil)
	if cmd == nil {
		t.Error("pressing `D` (destructive delete) returned nil cmd; expected stub")
	}
}
