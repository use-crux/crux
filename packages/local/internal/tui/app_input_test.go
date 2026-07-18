package tui

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type programFixtureClient struct {
	*uitest.FixtureClient
}

func (programFixtureClient) GetJSON(context.Context, string, any) error {
	return nil
}

func TestAppRoutesQIntoRunsFilterBeforeWorkspaceQuit(t *testing.T) {
	app := NewApp("http://localhost:4400", programFixtureClient{uitest.NewFixtureClient()}, "", false)
	app.MarkBootComplete()

	final, output, err := runTestProgram(t, app, "3/q\rq")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if final != app {
		t.Fatalf("final model = %T, want original *App", final)
	}
	if !strings.Contains(output, "/q") {
		t.Fatalf("Runs filter did not receive q before workspace quit:\n%s", output)
	}
	if !app.quitRequested {
		t.Fatal("workspace q did not request a clean quit")
	}
}
