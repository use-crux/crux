package overlays

import (
	"strings"
	"testing"
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
