package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
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

const documentProgramRunID = "run-document-scroll"

var documentPositionPattern = regexp.MustCompile(`\b\d+-\d+/\d+\b`)

type runsDocumentProgramClient struct {
	*uitest.FixtureClient

	mu          sync.Mutex
	detailCalls int
}

func newRunsDocumentProgramClient() *runsDocumentProgramClient {
	return &runsDocumentProgramClient{FixtureClient: uitest.NewFixtureClient()}
}

func (c *runsDocumentProgramClient) GetJSON(context.Context, string, any) error {
	return nil
}

func (c *runsDocumentProgramClient) ObservabilityRunsPage(context.Context, ...string) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{{
		RunID:         documentProgramRunID,
		Name:          "document scroll fixture",
		RootPrimitive: "agent",
		Status:        "failed",
	}}}, nil
}

func (c *runsDocumentProgramClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	c.mu.Lock()
	c.detailCalls++
	c.mu.Unlock()

	attributes := make(map[string]string, 30)
	for i := range 30 {
		attributes[fmt.Sprintf("field_%02d", i)] = strings.Repeat("evidence", 5)
	}
	rawAttributes, _ := json.Marshal(attributes)
	children := make([]api.ObservabilityRunDetailNode, 20)
	for i := range children {
		spanID := fmt.Sprintf("span-hierarchy-%02d", i)
		children[i] = api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID:     spanID,
				RunID:      runID,
				TraceID:    runID,
				Family:     "custom",
				Primitive:  "custom.long",
				Name:       fmt.Sprintf("hierarchy row %02d", i),
				Status:     "ok",
				Attributes: rawAttributes,
			},
			ID:       "span:" + spanID,
			ParentID: "span:span-document-scroll",
			Display: observability.RunDetailDisplay{
				Kind:  "custom",
				Label: fmt.Sprintf("hierarchy row %02d", i),
			},
		}
	}
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID:         runID,
			Name:          "document scroll fixture",
			RootPrimitive: "agent",
			Status:        "failed",
		},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID:     "span-document-scroll",
				RunID:      runID,
				TraceID:    runID,
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "long agent detail",
				Status:     "failed",
				Attributes: rawAttributes,
			},
			ID: "span:span-document-scroll",
			Display: observability.RunDetailDisplay{
				Kind:  "agent",
				Label: "long agent detail",
			},
			Children: children,
		},
	}, true, nil
}

type runsHierarchyProgramDriver struct {
	app             *App
	client          *runsDocumentProgramClient
	stage           int
	beforeHierarchy string
	afterHierarchy  string
	finalHierarchy  string
	beforeDocument  string
	afterDocument   string
}

func (d *runsHierarchyProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *runsHierarchyProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	runs, _ := d.app.workbench.activeScreen().(*screens.Runs)
	plain := ansi.Strip(d.app.View().Content)

	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if d.client.detailWasRequested() && runs != nil && runs.SelectedSpanID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l", Code: 'l'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.beforeHierarchy = runs.SelectedSpanID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyPgDown})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "pgdown" {
			d.afterHierarchy = runs.SelectedSpanID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l", Code: 'l'})
		}
	case 3:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.beforeDocument = documentPositionPattern.FindString(plain)
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyPgDown})
		}
	case 4:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "pgdown" {
			d.afterDocument = documentPositionPattern.FindString(plain)
			d.finalHierarchy = runs.SelectedSpanID()
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *runsHierarchyProgramDriver) View() tea.View { return d.app.View() }

func (c *runsDocumentProgramClient) detailWasRequested() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.detailCalls > 0
}

type runsDocumentProgramDriver struct {
	app    *App
	client *runsDocumentProgramClient
	stage  int
	before string
	after  string
}

func (d *runsDocumentProgramDriver) Init() tea.Cmd {
	return d.app.Init()
}

func (d *runsDocumentProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	plain := ansi.Strip(d.app.View().Content)

	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if d.client.detailWasRequested() {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l", Code: 'l'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l", Code: 'l'})
		}
	case 2:
		if position := documentPositionPattern.FindString(plain); position != "" {
			d.before = position
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyPgDown})
		}
	case 3:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "pgdown" {
			d.after = documentPositionPattern.FindString(plain)
			return d, tea.Quit
		}
	}

	return d, tea.Batch(appCmd, driverCmd)
}

func (d *runsDocumentProgramDriver) View() tea.View {
	return d.app.View()
}

func TestRunsDocumentScrollsThroughRealProgram(t *testing.T) {
	client := newRunsDocumentProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	driver := &runsDocumentProgramDriver{app: app, client: client}

	_, _, err := runTestProgram(t, driver, "")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.before == "" || driver.after == "" {
		t.Fatalf("visible document positions = %q -> %q, want both positions", driver.before, driver.after)
	}
	if driver.after == driver.before {
		t.Fatalf("document position after page down = %q, want change from %q", driver.after, driver.before)
	}
}

func TestRunsHierarchyAndDocumentNavigateIndependentlyThroughRealProgram(t *testing.T) {
	client := newRunsDocumentProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	driver := &runsHierarchyProgramDriver{app: app, client: client}

	_, _, err := runTestProgram(t, driver, "")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.beforeHierarchy == "" || driver.afterHierarchy == driver.beforeHierarchy {
		t.Fatalf("hierarchy selection after page down = %q, want change from %q", driver.afterHierarchy, driver.beforeHierarchy)
	}
	if driver.finalHierarchy != driver.afterHierarchy {
		t.Fatalf("detail navigation changed hierarchy selection from %q to %q", driver.afterHierarchy, driver.finalHierarchy)
	}
	if driver.beforeDocument == "" || driver.afterDocument == driver.beforeDocument {
		t.Fatalf("document position after page down = %q, want change from %q", driver.afterDocument, driver.beforeDocument)
	}
}
