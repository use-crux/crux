package overlays

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/shell"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestFinalSweepOverlaysFuzzResize(t *testing.T) {
	palette := NewPalette()
	palette.Open()

	help := NewHelp()
	help.SetScreenKeybinds("runs", []shell.Keybind{
		shell.Bind("j/k", "move"),
		shell.Bind("↵", "expand"),
		shell.Bind("e", "export"),
	})
	help.Open()

	inspect := NewInspect()
	inspect.Open("span retrieve", "8af2f1c", json.RawMessage(`{"query":"typed prompts","hits":4}`))

	cases := []struct {
		name string
		view func(width, height int) string
	}{
		{"palette", palette.View},
		{"help", help.View},
		{"inspect", inspect.View},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uitest.FuzzResize(t, tc.view)
		})
	}
}
