package tui

import (
	"context"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type rootContextKey struct{}

type rootContextProgramClient struct {
	*uitest.FixtureClient
	observed chan bool
}

func (c *rootContextProgramClient) GetJSON(context.Context, string, any) error {
	return nil
}

func (c *rootContextProgramClient) Overview(ctx context.Context) (api.InspectOverviewRecord, error) {
	c.observed <- ctx.Value(rootContextKey{}) == "root" && ctx.Err() == context.Canceled
	return api.InspectOverviewRecord{}, ctx.Err()
}

func (c *rootContextProgramClient) ObservabilityRunsPage(context.Context, ...string) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{
		{RunID: "run-a", Name: "run A"},
		{RunID: "run-b", Name: "run B"},
	}}, nil
}

func (c *rootContextProgramClient) ObservabilityRunDetail(ctx context.Context, _ string) (api.ObservabilityRunDetail, bool, error) {
	c.observed <- ctx.Value(rootContextKey{}) == "root" && ctx.Err() == context.Canceled
	return api.ObservabilityRunDetail{}, false, ctx.Err()
}

type rootContextObservedMsg bool

type rootContextProgramDriver struct {
	app      *App
	client   *rootContextProgramClient
	observed bool
}

func (d *rootContextProgramDriver) Init() tea.Cmd {
	observe := func() tea.Msg { return rootContextObservedMsg(<-d.client.observed) }
	return tea.Batch(d.app.Init(), observe)
}

func (d *rootContextProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, cmd := d.app.Update(msg)
	if observed, ok := msg.(rootContextObservedMsg); ok {
		d.observed = bool(observed)
		return d, tea.Quit
	}
	return d, cmd
}

func (d *rootContextProgramDriver) View() tea.View { return d.app.View() }

func TestAppThreadsRootContextIntoOverviewFetch(t *testing.T) {
	root := context.WithValue(context.Background(), rootContextKey{}, "root")
	root, cancel := context.WithCancel(root)
	cancel()
	client := &rootContextProgramClient{
		FixtureClient: uitest.NewFixtureClient(),
		observed:      make(chan bool, 1),
	}
	app := NewApp(root, "http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &rootContextProgramDriver{app: app, client: client}

	_, _, err := runTestProgram(t, driver, "")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if !driver.observed {
		t.Fatal("Overview fetch did not receive the canceled, value-tagged root context")
	}
}

func TestWorkbenchThreadsRootContextThroughRunsActionDispatch(t *testing.T) {
	root := context.WithValue(context.Background(), rootContextKey{}, "root")
	root, cancel := context.WithCancel(root)
	cancel()
	client := &rootContextProgramClient{
		FixtureClient: uitest.NewFixtureClient(),
		observed:      make(chan bool, 1),
	}
	workbench := NewWorkbench(root, client, client, "http://localhost:4400")

	loadRuns := workbench.activateTarget(NavTarget{NavID: "runs"}, true)
	if loadRuns == nil {
		t.Fatal("Runs activation did not schedule its list fetch")
	}
	workbench.Update(loadRuns())
	detail := workbench.Update(tea.KeyPressMsg(tea.Key{Text: "j", Code: 'j'}))
	if detail == nil {
		t.Fatal("Workbench Runs action did not schedule the selected detail fetch")
	}
	detail()

	if observed := <-client.observed; !observed {
		t.Fatal("Workbench dispatch did not preserve the canceled, value-tagged root context")
	}
}
