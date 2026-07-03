package screens

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestDatasetsFixtureRendersEditorAndLocalUndo(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)

	view := screen.View(Size{Width: 120, Height: 32})
	for _, want := range []string{"Datasets", "agent-loops", "case-001", "INPUT", "ASSERTIONS"} {
		if !strings.Contains(view, want) {
			t.Fatalf("Datasets view missing %q:\n%s", want, view)
		}
	}

	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}), client)
	if !screen.dirty {
		t.Fatalf("editing input did not mark screen dirty")
	}
	if !strings.Contains(screen.View(Size{Width: 120, Height: 32}), "unsaved") {
		t.Fatalf("dirty view does not surface unsaved state")
	}

	screen.Update(tea.KeyPressMsg(tea.Key{Code: 'z', Mod: tea.ModCtrl}), client)
	if screen.dirty {
		t.Fatalf("undo should restore the original snapshot and clear dirty state")
	}
}

func TestDatasetsDirtyEscapeRequiresSecondEscape(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)

	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Code: tea.KeyEsc}), client)
	if !screen.dirty || !screen.confirmLeave {
		t.Fatalf("first esc should keep dirty editor open and request confirmation")
	}

	screen.Update(tea.KeyPressMsg(tea.Key{Code: tea.KeyEsc}), client)
	if screen.dirty || screen.confirmLeave {
		t.Fatalf("second esc should discard local edits")
	}
}

func TestDatasetsSaveIsDeferredUntilWriteSurfaceExists(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)

	for _, bind := range screen.Keybinds() {
		if bind.Key == "^s" || bind.Label == "save" {
			t.Fatalf("Datasets advertised deferred save keybind: %+v", bind)
		}
	}

	screen.Update(tea.KeyPressMsg(tea.Key{Code: 's', Mod: tea.ModCtrl}), client)
	if !strings.Contains(screen.notice, "Phase 20") {
		t.Fatalf("ctrl+s notice = %q, want Phase 20 deferral", screen.notice)
	}
}

func TestDatasetsAddFromTraceIsDeferred(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)

	screen.Update(tea.KeyPressMsg(tea.Key{Text: "n", Code: 'n'}), client)
	if !strings.Contains(screen.notice, "Phase 20") {
		t.Fatalf("n notice = %q, want Phase 20 deferral", screen.notice)
	}
}

func fetchDatasetsForTest(t *testing.T, client *uitest.FixtureClient) tea.Msg {
	t.Helper()
	cmd := NewDatasets().Init(client)
	if cmd == nil {
		t.Fatalf("Datasets Init returned nil command")
	}
	return cmd()
}
