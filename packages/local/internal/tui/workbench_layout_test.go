package tui

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestWorkbenchShellFuzzResize(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")

	uitest.FuzzResize(t, func(width, height int) string {
		w.Resize(width, height)
		return w.View()
	})
}

func TestWorkbenchHidesNavRailInSingleColumn(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(70, 24)

	out := w.View()
	if strings.Contains(out, "Overview") {
		t.Fatalf("single-column workbench rendered nav rail label: %q", out)
	}
}
