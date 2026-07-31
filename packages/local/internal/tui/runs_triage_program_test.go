package tui

import (
	"context"
	"strings"
	"sync"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type triageProgramClient struct {
	*uitest.FixtureClient
	mu     sync.Mutex
	loaded bool
}

func newTriageProgramClient() *triageProgramClient {
	return &triageProgramClient{FixtureClient: uitest.NewFixtureClient()}
}

func (c *triageProgramClient) ObservabilityRunsPage(context.Context) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{{
		RunID: "run-triage", Name: "failed flow", RootPrimitive: "flow.run", Status: "error",
	}}}, nil
}

func (c *triageProgramClient) ObservabilityRunDetail(context.Context, string) (api.ObservabilityRunDetail, bool, error) {
	c.mu.Lock()
	c.loaded = true
	c.mu.Unlock()
	root := triageNode("root", "", "failed flow", "flow", "flow.run", "ok")
	healthy := triageNode("healthy", "root", "healthy unrelated", "tool", "tool.call", "ok")
	branch := triageNode("branch", "root", "failure branch", "flow", "flow.step", "ok")
	first := triageNode("failure-a", "branch", "first failure", "tool", "tool.call", "error")
	first.Error = []byte(`{"message":"first exploded"}`)
	second := triageNode("failure-b", "branch", "second failure", "generation", "generation.call", "error")
	second.Error = []byte(`{"message":"second exploded"}`)
	branch.Children = []api.ObservabilityRunDetailNode{first, second}
	root.Children = []api.ObservabilityRunDetailNode{healthy, branch}
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID: "run-triage", Name: "failed flow", RootPrimitive: "flow.run", Status: "error",
		},
		Root: root,
	}, true, nil
}

func triageNode(id, parent, name, family, primitive, status string) api.ObservabilityRunDetailNode {
	return api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{
			SpanID: id, ParentSpanID: parent, RunID: "run-triage", TraceID: "run-triage",
			Name: name, Family: family, Primitive: primitive, Status: status,
		},
		ID: "span:" + id, ParentID: parent,
		Display: observability.RunDetailDisplay{Kind: family, Label: name},
	}
}

func (c *triageProgramClient) detailLoaded() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.loaded
}

type triageProgramDriver struct {
	app              *App
	client           *triageProgramClient
	stage            int
	initialView      string
	initialSelected  string
	nextSelected     string
	previousSelected string
}

func (d *triageProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *triageProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	runs, _ := d.app.workbench.activeScreen().(*screens.Runs)
	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if d.client.detailLoaded() && runs != nil && runs.SelectedSpanID() != "" {
			d.initialView = ansi.Strip(d.app.View().Content)
			d.initialSelected = runs.SelectedSpanID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "e", Code: 'e'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "e" {
			d.nextSelected = runs.SelectedSpanID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "E", Code: 'E'})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "E" {
			d.previousSelected = runs.SelectedSpanID()
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *triageProgramDriver) View() tea.View { return d.app.View() }

func TestRunsFailureStepperAndCollapsedPathThroughRealProgram(t *testing.T) {
	client := newTriageProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	driver := &triageProgramDriver{app: app, client: client}

	final, _, err := runTestProgramAtSize(t, driver, "", 160, 45)
	if err != nil {
		t.Fatalf("run real program: %v", err)
	}
	got := final.(*triageProgramDriver)
	if got.initialSelected != "failure-a" || got.nextSelected != "failure-b" || got.previousSelected != "failure-a" {
		t.Fatalf("failure stepper selections = %q → %q → %q", got.initialSelected, got.nextSelected, got.previousSelected)
	}
	if contains := ansi.Strip(got.initialView); strings.Contains(contains, "healthy unrelated") {
		t.Fatalf("failed run did not collapse to its failure path:\n%s", contains)
	}
}
