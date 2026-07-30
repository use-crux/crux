package overlays

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestPaletteOmitsUnimplementedTraceOpening(t *testing.T) {
	palette := NewPalette()
	palette.Open()

	view := palette.View(100, 30)
	if strings.Contains(view, "open trace") || strings.Contains(view, "Open a trace") {
		t.Fatalf("palette advertised trace opening without an executable implementation:\n%s", view)
	}
}

func TestPaletteFooterOmitsUnimplementedHistory(t *testing.T) {
	palette := NewPalette()
	palette.Open()

	view := palette.View(100, 30)
	if strings.Contains(view, "^r") || strings.Contains(view, "history") {
		t.Fatalf("palette advertised command history without an implementation:\n%s", view)
	}
}

func TestPaletteIncludesEveryDefaultNavEntry(t *testing.T) {
	commands := defaultCommands()
	for _, item := range shell.DefaultNav {
		want := ":goto " + item.ID
		found := false
		for _, command := range commands {
			if command.Cmd == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("palette commands omit DefaultNav entry %q", item.ID)
		}
	}
}

func TestPaletteInputPlaceholderIsWhole(t *testing.T) {
	palette := NewPalette()
	palette.Open()

	view := palette.View(60, 20)
	if !strings.Contains(view, "type a command") {
		t.Fatalf("palette clipped its input placeholder:\n%s", view)
	}
}
