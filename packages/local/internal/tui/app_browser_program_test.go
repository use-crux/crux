package tui

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestAppWorkspaceOpenBrowserRunsOnceThroughRealProgram(t *testing.T) {
	app := newTestApp("http://localhost:4400", programFixtureClient{uitest.NewFixtureClient()}, "", false)
	app.MarkBootComplete()
	calls := 0
	app.SetBrowserOpener("http://localhost:4400?t=session", func(context.Context, string) error {
		calls++
		return nil
	})

	if _, _, err := runTestProgram(t, app, "oq"); err != nil {
		t.Fatalf("run app: %v", err)
	}
	if calls != 1 {
		t.Fatalf("browser calls = %d, want 1", calls)
	}
}
