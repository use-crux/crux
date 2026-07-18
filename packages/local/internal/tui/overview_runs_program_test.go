package tui

import (
	"context"
	"sync"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

const (
	firstSimilarRunID  = "run-similar-001"
	secondSimilarRunID = "run-similar-002"
)

type overviewRunsProgramClient struct {
	*uitest.FixtureClient

	mu                 sync.Mutex
	detailRequestedIDs []string
}

func newOverviewRunsProgramClient() *overviewRunsProgramClient {
	return &overviewRunsProgramClient{FixtureClient: uitest.NewFixtureClient()}
}

func (c *overviewRunsProgramClient) GetJSON(context.Context, string, any) error {
	return nil
}

func (c *overviewRunsProgramClient) Overview(context.Context) (api.InspectOverviewRecord, error) {
	return api.InspectOverviewRecord{
		Tag:        "InspectOverviewRecord",
		RunCount:   2,
		RecentRuns: c.inspectRuns(),
	}, nil
}

func (c *overviewRunsProgramClient) Runs(context.Context) ([]api.InspectRunRecord, error) {
	return c.inspectRuns(), nil
}

func (c *overviewRunsProgramClient) ObservabilityRuns(context.Context) ([]api.ObservabilityRunSummary, error) {
	return []api.ObservabilityRunSummary{
		c.observabilityRun(firstSimilarRunID),
		c.observabilityRun(secondSimilarRunID),
	}, nil
}

func (c *overviewRunsProgramClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	c.mu.Lock()
	c.detailRequestedIDs = append(c.detailRequestedIDs, runID)
	c.mu.Unlock()

	return api.ObservabilityRunDetail{
		Run: c.observabilityRun(runID),
		Root: api.ObservabilityRunDetailNode{
			ID: "run:" + runID,
		},
	}, true, nil
}

func (c *overviewRunsProgramClient) requestedRunID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.detailRequestedIDs) == 0 {
		return ""
	}
	return c.detailRequestedIDs[len(c.detailRequestedIDs)-1]
}

func (c *overviewRunsProgramClient) requestedRunIDs() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.detailRequestedIDs...)
}

func (c *overviewRunsProgramClient) inspectRuns() []api.InspectRunRecord {
	return []api.InspectRunRecord{
		{Tag: "InspectRunRecord", TraceID: firstSimilarRunID, TargetID: "shared workflow", Status: "failed"},
		{Tag: "InspectRunRecord", TraceID: secondSimilarRunID, TargetID: "shared workflow", Status: "failed"},
	}
}

func (c *overviewRunsProgramClient) observabilityRun(runID string) api.ObservabilityRunSummary {
	return api.ObservabilityRunSummary{
		RunID:         runID,
		Name:          "shared workflow",
		RootPrimitive: "agent",
		Status:        "failed",
	}
}

type overviewRunsProgramDriver struct {
	app   *App
	stage int
}

func (d *overviewRunsProgramDriver) Init() tea.Cmd {
	return d.app.Init()
}

func (d *overviewRunsProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)

	client := d.app.client.(*overviewRunsProgramClient)
	if client.requestedRunID() != "" {
		return d, tea.Quit
	}

	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		overview := d.app.workbench.screens["overview"].(*screens.Overview)
		if overview.SelectedRunID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l"})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "j"})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "j" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEnter})
		}
	}

	return d, tea.Batch(appCmd, driverCmd)
}

func (d *overviewRunsProgramDriver) View() tea.View {
	return d.app.View()
}

func keyCommand(key tea.KeyPressMsg) tea.Cmd {
	return func() tea.Msg { return key }
}

func TestOverviewDrillSelectsExactRunThroughRealProgram(t *testing.T) {
	client := newOverviewRunsProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &overviewRunsProgramDriver{app: app}

	_, _, err := runTestProgram(t, driver, "")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if app.workbench.activeNav != "runs" {
		t.Fatalf("active nav = %q, want runs", app.workbench.activeNav)
	}
	if got := client.requestedRunID(); got != secondSimilarRunID {
		t.Fatalf("run detail requested for %q, want exact Overview selection %q", got, secondSimilarRunID)
	}
	runs := app.workbench.screens["runs"].(*screens.Runs)
	if got := runs.SelectedRunID(); got != secondSimilarRunID {
		t.Fatalf("Runs selection = %q, want exact Overview selection %q", got, secondSimilarRunID)
	}
}

type overviewRunsBackProgramDriver struct {
	app               *App
	stage             int
	backActiveNav     string
	backSelectedRunID string
}

func (d *overviewRunsBackProgramDriver) Init() tea.Cmd {
	return d.app.Init()
}

func (d *overviewRunsBackProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	client := d.app.client.(*overviewRunsProgramClient)

	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		overview := d.app.workbench.screens["overview"].(*screens.Overview)
		if overview.SelectedRunID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l"})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "j"})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "j" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEnter})
		}
	case 3:
		if len(client.requestedRunIDs()) == 1 {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEscape})
		}
	case 4:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "esc" {
			d.backActiveNav = d.app.workbench.activeNav
			overview := d.app.workbench.screens["overview"].(*screens.Overview)
			d.backSelectedRunID = overview.SelectedRunID()
			if d.backActiveNav != "overview" {
				return d, tea.Quit
			}
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEnter})
		}
	case 5:
		if len(client.requestedRunIDs()) == 2 {
			return d, tea.Quit
		}
	}

	return d, tea.Batch(appCmd, driverCmd)
}

func (d *overviewRunsBackProgramDriver) View() tea.View {
	return d.app.View()
}

func TestBackRestoresOverviewRouteFocusAndRunSelection(t *testing.T) {
	client := newOverviewRunsProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &overviewRunsBackProgramDriver{app: app}

	_, _, err := runTestProgram(t, driver, "")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.backActiveNav != "overview" {
		t.Fatalf("Back active nav = %q, want overview", driver.backActiveNav)
	}
	if driver.backSelectedRunID != secondSimilarRunID {
		t.Fatalf("Back selected run = %q, want %q", driver.backSelectedRunID, secondSimilarRunID)
	}
	if got := client.requestedRunIDs(); len(got) != 2 || got[0] != secondSimilarRunID || got[1] != secondSimilarRunID {
		t.Fatalf("run detail requests = %#v, want exact run before and after Back", got)
	}
}
