package overlays

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestContentModalSizeClampsToSharedContract(t *testing.T) {
	size := contentModalSize(160, 45, 20, 3, 6)
	if got := size.innerWidth + 2; got != 40 {
		t.Fatalf("modal width = %d, want minimum 40", got)
	}
	if size.outerHeight != 9 {
		t.Fatalf("modal height = %d, want content+chrome 9", size.outerHeight)
	}

	size = contentModalSize(60, 20, 200, 200, 6)
	if got := size.innerWidth + 2; got != 56 {
		t.Fatalf("bounded modal width = %d, want viewport-4", got)
	}
	if size.outerHeight != 16 {
		t.Fatalf("bounded modal height = %d, want 80%% of viewport", size.outerHeight)
	}
}

func TestInspectModalUsesContentHeight(t *testing.T) {
	inspect := NewInspect()
	inspect.OpenText("Runtime setup", "1 issue", "one\ntwo\nthree")
	view := inspect.View(160, 45)

	if got := len(strings.Split(view, "\n")); got != 9 {
		t.Fatalf("three-line inspect modal rendered %d rows, want 9:\n%s", got, view)
	}
	for _, line := range strings.Split(view, "\n") {
		if got := lipgloss.Width(line); got > 156 {
			t.Fatalf("inspect modal width = %d, want <= screen-4", got)
		}
	}
}

func TestInspectModalWidthUsesLongestBodyLine(t *testing.T) {
	inspect := NewInspect()
	inspect.OpenText("Details", "", strings.Repeat("a", 80)+"\n"+strings.Repeat("b", 80))
	view := inspect.View(300, 45)

	if got := lipgloss.Width(strings.Split(view, "\n")[0]); got != 84 {
		t.Fatalf("inspect modal width = %d, want longest line + padding", got)
	}
}

func TestSparseOverlaysHonorMinimumHeight(t *testing.T) {
	palette := NewPalette()
	palette.Open()
	palette.input = "no-match"
	palette.refilter()

	help := NewHelp()
	help.Open()

	for name, view := range map[string]string{
		"palette": palette.View(160, 45),
		"help":    help.View(160, 45),
	} {
		if got := len(strings.Split(view, "\n")); got != modalMinHeight {
			t.Errorf("%s height = %d, want minimum %d:\n%s", name, got, modalMinHeight, view)
		}
	}
}

func TestHelpOverlayHonorsEightyPercentHeight(t *testing.T) {
	help := NewHelp()
	binds := make([]shell.Keybind, 30)
	for index := range binds {
		binds[index] = shell.Bind("x", "action")
	}
	help.SetScreenKeybinds("runs", binds)
	help.Open()

	if got := len(strings.Split(help.View(100, 20), "\n")); got != 16 {
		t.Fatalf("help height = %d, want 80%% of viewport", got)
	}
}

func TestHelpOverlayAccountsForColumnDividers(t *testing.T) {
	help := NewHelp()
	help.SetKeybinds(
		"runs",
		[]shell.Keybind{shell.Bind("w", "workspace")},
		[]shell.Keybind{shell.Bind("s", "screen")},
	)
	help.Open()

	for _, line := range strings.Split(help.View(40, 20), "\n") {
		if got := lipgloss.Width(line); got > 36 {
			t.Fatalf("help width = %d, want <= screen-4", got)
		}
	}
}
