package kit

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestDocumentPaneLineScrollsAndReportsVisiblePosition(t *testing.T) {
	t.Parallel()

	pane := NewDocumentPane()
	pane.SetContent("doc", "alpha\nbeta\ngamma\ndelta")
	pane.SetSize(12, 2)
	pane.SetFocused(true)

	if handled := pane.Update(tea.KeyPressMsg{Text: "j", Code: 'j'}); !handled {
		t.Fatal("focused pane did not handle line scrolling")
	}

	position := pane.Position()
	if position.Offset != 1 || position.FirstLine != 2 || position.LastLine != 3 || position.TotalLines != 4 {
		t.Fatalf("position = %+v, want offset 1 and visible lines 2-3 of 4", position)
	}
	lines := pane.Render()
	if len(lines) != 2 || strings.TrimSpace(lines[0]) != "beta" || strings.TrimSpace(lines[1]) != "gamma" {
		t.Fatalf("rendered lines = %#v, want beta and gamma", lines)
	}

	pane.Update(tea.KeyPressMsg{Text: "k", Code: 'k'})
	if got := pane.Position().Offset; got != 0 {
		t.Fatalf("offset after line up = %d, want 0", got)
	}
}

func TestDocumentPanePageHomeEndStayWithinBounds(t *testing.T) {
	t.Parallel()

	pane := NewDocumentPane()
	pane.SetContent("doc", strings.Join([]string{
		"line 1", "line 2", "line 3", "line 4", "line 5",
		"line 6", "line 7", "line 8", "line 9", "line 10",
	}, "\n"))
	pane.SetSize(20, 3)
	pane.SetFocused(true)

	steps := []struct {
		key  tea.KeyPressMsg
		want int
	}{
		{key: tea.KeyPressMsg{Code: tea.KeyPgDown}, want: 3},
		{key: tea.KeyPressMsg{Code: tea.KeyEnd}, want: 7},
		{key: tea.KeyPressMsg{Code: tea.KeyPgDown}, want: 7},
		{key: tea.KeyPressMsg{Code: tea.KeyHome}, want: 0},
		{key: tea.KeyPressMsg{Code: tea.KeyPgUp}, want: 0},
	}
	for _, step := range steps {
		if handled := pane.Update(step.key); !handled {
			t.Fatalf("pane did not handle %q", step.key.String())
		}
		if got := pane.Position().Offset; got != step.want {
			t.Fatalf("after %q offset = %d, want %d", step.key.String(), got, step.want)
		}
	}
}

func TestDocumentPaneResizePreservesLogicalSourceAnchor(t *testing.T) {
	t.Parallel()

	pane := NewDocumentPane()
	pane.SetContent("doc", strings.Join([]string{
		"introduction",
		"anchor carries enough words to wrap across several rows",
		"conclusion",
	}, "\n"))
	pane.SetSize(12, 2)
	pane.SetFocused(true)
	if got := pane.Position().TotalLines; got <= 3 {
		t.Fatalf("wrapped line count = %d, want more than the three source lines", got)
	}
	pane.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})

	if got := pane.lines[pane.offset].sourceLine; got != 1 {
		t.Fatalf("source line before resize = %d, want anchor line 1", got)
	}

	pane.SetSize(24, 2)

	if got := pane.lines[pane.offset].sourceLine; got != 1 {
		t.Fatalf("source line after resize = %d, want preserved anchor line 1", got)
	}
	if first := strings.TrimSpace(pane.Render()[0]); !strings.HasPrefix(first, "anchor") {
		t.Fatalf("first visible line after resize = %q, want anchored source line", first)
	}
}

func TestDocumentPaneResizePreservesPositionWithinLongSourceLine(t *testing.T) {
	t.Parallel()

	content := "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	pane := NewDocumentPane()
	pane.SetContent("doc", content)
	pane.SetSize(10, 2)
	pane.SetFocused(true)
	pane.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	if got := strings.TrimSpace(pane.Render()[0]); got != "klmnopqrst" {
		t.Fatalf("first visible fragment before resize = %q, want klmnopqrst", got)
	}

	pane.SetSize(15, 2)

	if got := strings.TrimSpace(pane.Render()[0]); got != "fghijklmnopqrst" {
		t.Fatalf("first visible fragment after resize = %q, want anchored fghijklmnopqrst", got)
	}
}

func TestDocumentPaneTracksDroppedWrapWhitespaceInSourceAnchor(t *testing.T) {
	t.Parallel()

	content := "zero one two three four five six seven eight nine ten eleven twelve"
	pane := NewDocumentPane()
	pane.SetContent("doc", content)
	pane.SetSize(10, 2)
	pane.SetFocused(true)
	pane.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})

	top := pane.lines[pane.offset]
	plainTop := ansi.Strip(top.text)
	byteOffset := strings.Index(content, plainTop)
	if byteOffset < 0 {
		t.Fatalf("top fragment %q is not present in source", plainTop)
	}
	wantCell := lipgloss.Width(content[:byteOffset])
	if top.sourceCell != wantCell {
		t.Fatalf("source-cell anchor = %d, want actual source offset %d for %q", top.sourceCell, wantCell, plainTop)
	}

	pane.SetSize(15, 2)
	anchored := pane.lines[pane.offset]
	if anchored.sourceCell > wantCell || wantCell-anchored.sourceCell >= 15 {
		t.Fatalf("rewrapped source-cell range starts at %d, want it to contain prior offset %d", anchored.sourceCell, wantCell)
	}
}

func TestDocumentPaneHardWrapsUnicodeAndUnbrokenContentWithinBounds(t *testing.T) {
	t.Parallel()

	content := "界界界界界界abcdefghijklmnop🙂🙂🙂"
	pane := NewDocumentPane()
	pane.SetContent("unicode", content)
	pane.SetSize(8, 20)

	var reconstructed strings.Builder
	for _, line := range pane.lines {
		if width := lipgloss.Width(line.text); width > 8 {
			t.Fatalf("wrapped line width = %d, want <= 8: %q", width, ansi.Strip(line.text))
		}
		reconstructed.WriteString(ansi.Strip(line.text))
	}
	if got := reconstructed.String(); got != content {
		t.Fatalf("reconstructed content = %q, want lossless %q", got, content)
	}
	for _, line := range pane.Render() {
		if width := lipgloss.Width(line); width != 8 {
			t.Fatalf("rendered line width = %d, want exact pane width 8", width)
		}
	}
}

func TestDocumentPaneFocusGatesKeyboardAndMouseScrolling(t *testing.T) {
	t.Parallel()

	pane := NewDocumentPane()
	pane.SetContent("doc", "one\ntwo\nthree\nfour")
	pane.SetSize(10, 2)

	if handled := pane.Update(tea.KeyPressMsg{Text: "j", Code: 'j'}); handled {
		t.Fatal("unfocused pane handled keyboard scrolling")
	}
	if handled := pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelDown}); handled {
		t.Fatal("unfocused pane handled mouse scrolling")
	}

	pane.SetFocused(true)
	if handled := pane.Update(tea.MouseWheelMsg{Button: tea.MouseWheelDown}); !handled {
		t.Fatal("focused pane did not handle mouse scrolling")
	}
	if got := pane.Position().Offset; got != 1 {
		t.Fatalf("offset after mouse scroll = %d, want 1", got)
	}

	pane.SetFocused(false)
	if handled := pane.Update(tea.KeyPressMsg{Text: "k", Code: 'k'}); handled {
		t.Fatal("pane handled keyboard scrolling after losing focus")
	}
	if got := pane.Position().Offset; got != 1 {
		t.Fatalf("offset after losing focus = %d, want 1", got)
	}
}

func TestDocumentPaneRepeatedLayoutKeepsExactWrappedOffset(t *testing.T) {
	t.Parallel()

	content := "one two three four five six seven eight nine ten"
	pane := NewDocumentPane()
	pane.SetContent("doc", content)
	pane.SetSize(10, 2)
	pane.SetFocused(true)
	pane.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	if got := pane.Position().Offset; got != 2 {
		t.Fatalf("offset before repeated layout = %d, want 2", got)
	}

	pane.SetSize(10, 2)
	pane.SetContent("doc", content)

	if got := pane.Position().Offset; got != 2 {
		t.Fatalf("offset after repeated layout = %d, want exact wrapped offset 2", got)
	}
}

func TestDocumentPaneHeightOnlyResizeKeepsExactWrappedOffset(t *testing.T) {
	t.Parallel()

	pane := NewDocumentPane()
	pane.SetContent("doc", "one two three four five six seven eight nine ten")
	pane.SetSize(10, 2)
	pane.SetFocused(true)
	pane.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})

	pane.SetSize(10, 3)

	if got := pane.Position().Offset; got != 2 {
		t.Fatalf("offset after height-only resize = %d, want exact wrapped offset 2", got)
	}
}
