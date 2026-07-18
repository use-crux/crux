package commands

import (
	"context"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type commandRootContextKey struct{}

type commandRootContextClient struct {
	*uitest.FixtureClient
	observed chan bool
}

func (c *commandRootContextClient) GetJSON(context.Context, string, any) error {
	return nil
}

func (c *commandRootContextClient) Overview(ctx context.Context) (api.InspectOverviewRecord, error) {
	c.observed <- ctx.Value(commandRootContextKey{}) == "root" && ctx.Err() == context.Canceled
	return api.InspectOverviewRecord{}, ctx.Err()
}

func TestTUIConstructionThreadsCommandRootContext(t *testing.T) {
	root := context.WithValue(context.Background(), commandRootContextKey{}, "root")
	root, cancel := context.WithCancel(root)
	cancel()
	client := &commandRootContextClient{
		FixtureClient: uitest.NewFixtureClient(),
		observed:      make(chan bool, 1),
	}
	app := newTUIApp(root, "http://localhost:4400", client, newStartupTracker(false))
	app.MarkBootComplete()

	executeTUICommand(app.Init())
	if observed := <-client.observed; !observed {
		t.Fatal("TUI construction did not preserve the canceled, value-tagged command context")
	}
}

func executeTUICommand(cmd tea.Cmd) {
	if cmd == nil {
		return
	}
	msg := cmd()
	if batch, ok := msg.(tea.BatchMsg); ok {
		for _, child := range batch {
			executeTUICommand(child)
		}
	}
}
