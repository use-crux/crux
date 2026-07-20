package tui

import (
	"context"
	"fmt"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type overviewScrollableClient struct {
	*overviewRunsProgramClient
}

func newOverviewScrollableClient() *overviewScrollableClient {
	return &overviewScrollableClient{overviewRunsProgramClient: newOverviewRunsProgramClient()}
}

func (c *overviewScrollableClient) Overview(context.Context) (api.InspectOverviewRecord, error) {
	return api.InspectOverviewRecord{Tag: "InspectOverviewRecord", RunCount: len(c.scrollableRuns())}, nil
}

func (c *overviewScrollableClient) Runs(context.Context) ([]api.InspectRunRecord, error) {
	return c.scrollableRuns(), nil
}

func (c *overviewScrollableClient) scrollableRuns() []api.InspectRunRecord {
	runs := make([]api.InspectRunRecord, 12)
	for i := range runs {
		runs[i] = api.InspectRunRecord{
			Tag:      "InspectRunRecord",
			TraceID:  fmt.Sprintf("run-scroll-%02d", i+1),
			TargetID: "scrollable workflow",
			Status:   "failed",
		}
	}
	return runs
}

type overviewListNavigationDriver struct {
	app   *App
	stage int
}

func (d *overviewListNavigationDriver) Init() tea.Cmd { return d.app.Init() }

func (d *overviewListNavigationDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	var driverCmd tea.Cmd
	overview := d.app.workbench.screens["overview"].(*screens.Overview)
	switch d.stage {
	case 0:
		if overview.SelectedRunID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l"})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEnd})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "end" {
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *overviewListNavigationDriver) View() tea.View { return d.app.View() }

func TestOverviewFocusedListConsumesEndThroughRealWorkbench(t *testing.T) {
	client := newOverviewScrollableClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &overviewListNavigationDriver{app: app}

	_, _, err := runTestProgramAtSize(t, driver, "", 100, 30)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	overview := app.workbench.screens["overview"].(*screens.Overview)
	if got := overview.SelectedRunID(); got != "run-scroll-12" {
		t.Fatalf("Overview selection after end = %q, want last stable run ID", got)
	}
}
