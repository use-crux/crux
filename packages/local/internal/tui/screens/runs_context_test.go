package screens

import (
	"context"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type runsContextKey struct{}

type runsContextClient struct {
	*uitest.FixtureClient
	observed chan bool
}

func (c *runsContextClient) ObservabilityRunDetail(ctx context.Context, _ string) (api.ObservabilityRunDetail, bool, error) {
	c.observed <- ctx.Value(runsContextKey{}) == "root" && ctx.Err() == context.Canceled
	return api.ObservabilityRunDetail{}, false, ctx.Err()
}

func TestRunsActionThreadsRootContextIntoDetailFetch(t *testing.T) {
	root := context.WithValue(context.Background(), runsContextKey{}, "root")
	root, cancel := context.WithCancel(root)
	cancel()
	client := &runsContextClient{
		FixtureClient: uitest.NewFixtureClient(),
		observed:      make(chan bool, 1),
	}
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{{RunID: "run-1"}, {RunID: "run-2"}}
	setRunsForTest(runs, values...)
	runs.runList.SetItems(values)
	runs.runList.Select("run-1")

	cmd, handled := interaction.Dispatch(
		runs.Actions(root, client),
		tea.KeyPressMsg(tea.Key{Text: "j", Code: 'j'}),
	)
	if !handled || cmd == nil {
		t.Fatal("next-run action did not schedule a detail fetch")
	}
	fetch := runs.Update(root, cmd(), client)
	if fetch == nil {
		t.Fatal("latest detail intent did not schedule a detail fetch")
	}
	fetch()

	select {
	case observed := <-client.observed:
		if !observed {
			t.Fatal("Runs action did not preserve the canceled, value-tagged root context")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the detail fetch")
	}
}
