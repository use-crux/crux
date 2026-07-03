package screens

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestDatasetsFuzzResize(t *testing.T) {
	screen := fixtureDatasetsScreen(t)
	uitest.FuzzResize(t, func(width, height int) string {
		return screen.View(Size{Width: width, Height: height})
	})
}

func TestDatasetsGoldens(t *testing.T) {
	cases := []struct {
		name   string
		width  int
		height int
		screen *Datasets
	}{
		{"datasets-160x45", 160, 45, fixtureDatasetsScreen(t)},
		{"datasets-100x30", 100, 30, fixtureDatasetsScreen(t)},
		{"datasets-70x24", 70, 24, fixtureDatasetsScreen(t)},
		{"datasets-dirty", 120, 32, dirtyDatasetsScreen(t)},
		{"datasets-empty", 100, 30, emptyDatasetsScreen()},
		{"datasets-pending", 100, 30, pendingDatasetsScreen()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uitest.Golden(t, tc.name, tc.screen.View(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func fixtureDatasetsScreen(t *testing.T) *Datasets {
	t.Helper()
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)
	return screen
}

func dirtyDatasetsScreen(t *testing.T) *Datasets {
	t.Helper()
	client := uitest.NewFixtureClient()
	screen := NewDatasets()
	screen.Update(fetchDatasetsForTest(t, client), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "l", Code: 'l'}), client)
	screen.Update(tea.KeyPressMsg(tea.Key{Text: "!", Code: '!'}), client)
	return screen
}

func emptyDatasetsScreen() *Datasets {
	screen := NewDatasets()
	screen.loaded = true
	return screen
}

func pendingDatasetsScreen() *Datasets {
	screen := NewDatasets()
	screen.Update(datasetsPendingMsg("dataset suite service is pending Phase 20"), nil)
	return screen
}
