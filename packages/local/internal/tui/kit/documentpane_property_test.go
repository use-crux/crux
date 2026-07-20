package kit

import (
	"math/rand"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func TestDocumentPaneProperties(t *testing.T) {
	t.Parallel()

	rng := rand.New(rand.NewSource(29))
	keys := []tea.KeyPressMsg{
		{Text: "j", Code: 'j'},
		{Text: "k", Code: 'k'},
		{Code: tea.KeyPgDown},
		{Code: tea.KeyPgUp},
		{Code: tea.KeyHome},
		{Code: tea.KeyEnd},
	}
	fragments := []string{"alpha", "界界", "🙂", strings.Repeat("x", 40), "two words"}
	for caseN := 0; caseN < 500; caseN++ {
		pane := NewDocumentPane()
		pane.SetFocused(true)
		for step := 0; step < 50; step++ {
			switch rng.Intn(5) {
			case 0:
				lineCount := rng.Intn(12)
				lines := make([]string, lineCount)
				for i := range lines {
					lines[i] = fragments[rng.Intn(len(fragments))]
				}
				pane.SetContent("doc", strings.Join(lines, "\n"))
			case 1:
				pane.SetSize(rng.Intn(30), rng.Intn(12))
			case 2:
				pane.Update(keys[rng.Intn(len(keys))])
			case 3:
				pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelDown})
			default:
				pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelUp})
			}
			assertDocumentPaneInvariants(t, pane)
		}
	}
}

func assertDocumentPaneInvariants(t *testing.T, pane *DocumentPane) {
	t.Helper()
	maxOffset := max(0, len(pane.lines)-pane.height)
	if pane.offset < 0 || pane.offset > maxOffset {
		t.Fatalf("offset = %d, want within [0,%d]", pane.offset, maxOffset)
	}
	position := pane.Position()
	if position.Offset != pane.offset || position.TotalLines != len(pane.lines) {
		t.Fatalf("position = %+v, want offset %d and total %d", position, pane.offset, len(pane.lines))
	}
	if position.FirstLine > 0 && (position.FirstLine != pane.offset+1 || position.LastLine > position.TotalLines) {
		t.Fatalf("invalid visible position: %+v", position)
	}
	for _, line := range pane.Render() {
		if width := lipgloss.Width(line); width > pane.width {
			t.Fatalf("rendered width = %d, want <= %d", width, pane.width)
		}
	}
}
