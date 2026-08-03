package screens

import (
	"strings"
	"testing"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestEvalsGoldens(t *testing.T) {
	for _, test := range []struct {
		name   string
		width  int
		height int
	}{
		{name: "evals-70x24", width: 70, height: 24},
		{name: "evals-100x30", width: 100, height: 30},
		{name: "evals-160x45", width: 160, height: 45},
	} {
		t.Run(test.name, func(t *testing.T) {
			screen := fixtureEvalsForGolden(t)
			size := Size{Width: test.width, Height: test.height}
			screen.Resize(size)
			uitest.Golden(t, test.name, screen.View(size))
		})
	}
}

func TestEvalsSupportedLayoutsAreExactlyBounded(t *testing.T) {
	for _, size := range []Size{
		{Width: 70, Height: 24},
		{Width: 100, Height: 30},
		{Width: 160, Height: 45},
		{Width: 59, Height: 19},
	} {
		screen := fixtureEvalsForGolden(t)
		screen.Resize(size)
		lines := strings.Split(screen.View(size), "\n")
		if len(lines) != size.Height {
			t.Fatalf("%dx%d lines = %d, want %d", size.Width, size.Height, len(lines), size.Height)
		}
		for index, line := range lines {
			if width := lipgloss.Width(line); width != size.Width {
				t.Fatalf("%dx%d line %d width = %d, want %d", size.Width, size.Height, index+1, width, size.Width)
			}
		}
	}
}

func TestEvalsFuzzResize(t *testing.T) {
	screen := fixtureEvalsForGolden(t)
	uitest.FuzzResize(t, func(width, height int) string {
		size := Size{Width: width, Height: height}
		screen.Resize(size)
		return screen.View(size)
	})
}

func fixtureEvalsForGolden(t *testing.T) *Evals {
	t.Helper()
	client := uitest.NewFixtureClient()
	screen := loadedFixtureEvals(t, client)
	screen.now = func() time.Time { return client.Now }
	screen.setFocus(evalsFocusGrid)
	screen.cellRow, screen.cellColumn = 0, 1
	applyEvalsCommand(t, screen, screen.fetchSelectedLocalRun(testContext, client), client)
	screen.syncDetail(true)
	return screen
}
