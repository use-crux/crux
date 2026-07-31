package tui

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type indexPhaseCProgramClient struct {
	*uitest.FixtureClient
	mu               sync.Mutex
	runsDefinitionID string
}

func newIndexPhaseCProgramClient() *indexPhaseCProgramClient {
	return &indexPhaseCProgramClient{FixtureClient: uitest.NewFixtureClient()}
}

func (c *indexPhaseCProgramClient) ProjectIndex(context.Context) (api.IndexData, error) {
	return api.IndexData{
		Definitions: []api.ProjectDefinition{
			{ID: "prompt:source", Kind: "prompt", Name: "source"},
			{ID: "context:target", Kind: "context", Name: "target"},
		},
		Relations: []api.ProjectRelation{{
			Type: "prompt.uses_context", From: "prompt:source", To: "context:target",
		}},
	}, nil
}

func (c *indexPhaseCProgramClient) DefinitionActivity(_ context.Context, definitionID string) (api.CatalogRuntimeActivityV1, error) {
	return api.CatalogRuntimeActivityV1{
		DefinitionID: definitionID,
		RunCount:     2,
		LastRunID:    "run:target",
		LastRunAt:    time.Now().Add(-time.Minute).Format(time.RFC3339),
		LastStatus:   "ok",
	}, nil
}

func (c *indexPhaseCProgramClient) ObservabilityRunsPage(_ context.Context, definitionID ...string) (api.ObservabilityRunsPage, error) {
	if len(definitionID) > 0 {
		c.mu.Lock()
		c.runsDefinitionID = definitionID[0]
		c.mu.Unlock()
	}
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{{
		RunID: "run:target", Name: "target run", Status: "ok",
	}}}, nil
}

func (c *indexPhaseCProgramClient) selectedRunsDefinitionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.runsDefinitionID
}

type indexPhaseCProgramDriver struct {
	app    *App
	client *indexPhaseCProgramClient
	stage  int
	err    string
}

func (d *indexPhaseCProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *indexPhaseCProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	key := func(message tea.KeyPressMsg) tea.Cmd {
		return keyCommand(message)
	}
	fail := func(format string, args ...any) (tea.Model, tea.Cmd) {
		d.err = fmt.Sprintf(format, args...)
		return d, tea.Quit
	}

	index := d.app.workbench.screens["index"]
	switch d.stage {
	case 0:
		if selected, ok := index.(interface{ SelectedDefinitionID() string }); ok &&
			selected.SelectedDefinitionID() == "prompt:source" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnter}))
		}
	case 1:
		if pressed, ok := msg.(tea.KeyPressMsg); ok && pressed.Code == tea.KeyEnter {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnter}))
		}
	case 2:
		if d.app.workbench.activeTarget == (NavTarget{
			NavID: "index", Kind: Kind("definition"), ID: "context:target",
		}) && indexRunsActionEnabled(index.(*screens.Index), d.client) {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "r", Code: 'r'}))
		}
	case 3:
		runsDefinitionID := d.client.selectedRunsDefinitionID()
		if d.app.workbench.activeNav == "runs" && runsDefinitionID != "" {
			if runsDefinitionID != "context:target" {
				return fail("Runs definition filter = %q, want context:target", runsDefinitionID)
			}
			return d, tea.Quit
		}
	}
	return d, appCmd
}

func (d *indexPhaseCProgramDriver) View() tea.View { return d.app.View() }

func indexRunsActionEnabled(index *screens.Index, client screens.DataClient) bool {
	for _, action := range index.Actions(context.Background(), client) {
		if action.ID == "index.runs" {
			return action.Enabled()
		}
	}
	return false
}

func TestIndexRelationAndRuntimeJumpsThroughRealProgram(t *testing.T) {
	client := newIndexPhaseCProgramClient()
	app := newTestApp("http://localhost:4750", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "index"
	app.workbench.activeTarget = NavTarget{NavID: "index"}

	driver := &indexPhaseCProgramDriver{app: app, client: client}
	if _, _, err := runTestProgramAtSize(t, driver, "", 100, 30); err != nil {
		t.Fatalf("run app at stage %d (target %#v): %v", driver.stage, app.workbench.activeTarget, err)
	}
	if driver.err != "" {
		t.Fatal(driver.err)
	}
	if driver.stage != 3 {
		t.Fatalf("program stopped at stage %d, want relation and runtime routes complete", driver.stage)
	}
}
