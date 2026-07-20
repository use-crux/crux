package tui

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

const (
	definitionNavigationID = "agent:authored-support"
)

type definitionNavigationProgramClient struct {
	*uitest.FixtureClient
}

func newDefinitionNavigationProgramClient() *definitionNavigationProgramClient {
	return &definitionNavigationProgramClient{FixtureClient: uitest.NewFixtureClient()}
}

func (c *definitionNavigationProgramClient) GetJSON(context.Context, string, any) error {
	return nil
}

func (c *definitionNavigationProgramClient) ObservabilityRunsPage(context.Context) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{{
		RunID: "run-definition-source", Name: "definition source navigation",
	}}}, nil
}

func (c *definitionNavigationProgramClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	children := make([]api.ObservabilityRunDetailNode, 18)
	for index := range children {
		children[index] = api.ObservabilityRunDetailNode{
			ID: fmt.Sprintf("node-%02d", index+1),
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID:       fmt.Sprintf("span-%02d", index+1),
				ParentSpanID: "span-root",
				Name:         fmt.Sprintf("activity %02d", index+1),
			},
		}
	}
	children[len(children)-1].DefinitionRefs = []observability.DefinitionRef{{
		ID:   definitionNavigationID,
		Kind: "agent",
		Role: "invoke",
		Source: &observability.SanitizedSourceRef{
			File: "runtime/generated.ts", Line: 3,
		},
	}}
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: runID, Name: "definition source navigation"},
		Root: api.ObservabilityRunDetailNode{
			ID: "root",
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID: "span-root", Name: "root",
			},
			Children: children,
		},
	}, true, nil
}

func (c *definitionNavigationProgramClient) ProjectIndex(context.Context) (api.IndexData, error) {
	column := 9
	return api.IndexData{Definitions: []api.ProjectDefinition{{
		ID:          definitionNavigationID,
		Kind:        "agent",
		Name:        "Authored support agent",
		Description: strings.Repeat("identity detail before authored source ", 24),
		Fidelity:    "resolved",
		Source: &api.SourceLoc{
			File: "src/agents/support.ts", Line: 77, Column: &column, Function: "createSupportAgent",
		},
		SourceSnippet: &api.SourceSnippet{
			Source:   strings.Repeat("const authoredSource = true\n", 24),
			Language: "typescript",
			Range:    api.SourceRange{File: "src/agents/support.ts", StartLine: 77},
		},
	}}}, nil
}

type definitionNavigationProgramDriver struct {
	app                 *App
	stage               int
	runsLocationBefore  screens.ScreenLocation
	runsLocationAfter   screens.ScreenLocation
	indexLocationBefore screens.ScreenLocation
	indexLocationAfter  screens.ScreenLocation
	indexSnapshotBefore string
	indexSnapshotAfter  string
	err                 string
}

func (d *definitionNavigationProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *definitionNavigationProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	key := func(message tea.KeyPressMsg) tea.Cmd { return keyCommand(message) }
	pressedKey := ""
	if pressed, ok := msg.(tea.KeyPressMsg); ok {
		pressedKey = pressed.String()
	}
	fail := func(format string, args ...any) (tea.Model, tea.Cmd) {
		d.err = fmt.Sprintf(format, args...)
		return d, tea.Quit
	}

	switch d.stage {
	case 0:
		runs := d.app.workbench.screens["runs"].(*screens.Runs)
		if runs.SelectedSpanID() != "" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "l", Code: 'l'}))
		}
	case 1:
		if pressedKey == "l" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnd}))
		}
	case 2:
		if pressedKey == "end" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "l", Code: 'l'}))
		}
	case 3:
		if pressedKey == "l" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyPgDown}))
		}
	case 4:
		if pressedKey == "pgdown" {
			runs := d.app.workbench.screens["runs"].(*screens.Runs)
			d.runsLocationBefore = runs.CaptureLocation()
			if runs.SelectedSpanID() != "span-18" {
				return fail("selected span before definition navigation = %q", runs.SelectedSpanID())
			}
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "d", Code: 'd'}))
		}
	case 5:
		index := d.app.workbench.screens["index"].(*screens.Index)
		if d.app.workbench.activeTarget == (NavTarget{NavID: "index", Kind: "definition", ID: definitionNavigationID}) &&
			index.SelectedDefinitionID() == definitionNavigationID {
			d.indexLocationBefore = index.CaptureLocation()
			d.indexSnapshotBefore = ansi.Strip(d.app.View().Content)
			d.stage++
			return d, tea.Batch(appCmd, func() tea.Msg {
				return tea.WindowSizeMsg{Width: 100, Height: 30}
			})
		}
	case 6:
		if size, ok := msg.(tea.WindowSizeMsg); ok && size.Width == 100 {
			index := d.app.workbench.screens["index"].(*screens.Index)
			d.indexLocationAfter = index.CaptureLocation()
			d.indexSnapshotAfter = ansi.Strip(d.app.View().Content)
			d.stage++
			return d, tea.Batch(appCmd, func() tea.Msg {
				return tea.WindowSizeMsg{Width: 70, Height: 24}
			})
		}
	case 7:
		if size, ok := msg.(tea.WindowSizeMsg); ok && size.Width == 70 {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEscape}))
		}
	case 8:
		if d.app.workbench.activeNav == "runs" {
			d.runsLocationAfter = d.app.workbench.screens["runs"].(*screens.Runs).CaptureLocation()
			if reflect.DeepEqual(d.runsLocationAfter, d.runsLocationBefore) {
				return d, tea.Quit
			}
		}
	}
	return d, appCmd
}

func (d *definitionNavigationProgramDriver) View() tea.View { return d.app.View() }

func TestRunsDefinitionNavigationAnchorsAuthoredIndexSourceAndRestoresLocationThroughRealProgram(t *testing.T) {
	client := newDefinitionNavigationProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	driver := &definitionNavigationProgramDriver{app: app}

	_, _, err := runTestProgramAtSize(t, driver, "", 70, 24)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.err != "" {
		t.Fatal(driver.err)
	}
	for label, snapshot := range map[string]string{
		"initial route": driver.indexSnapshotBefore,
		"after resize":  driver.indexSnapshotAfter,
	} {
		for _, authored := range []string{"src/agents/support.ts:77:9", "createSupportAgent"} {
			if !strings.Contains(snapshot, authored) {
				t.Fatalf("%s did not show authored source component %q:\n%s", label, authored, snapshot)
			}
		}
		if strings.Contains(snapshot, "runtime/generated.ts") {
			t.Fatalf("%s used runtime reference metadata as the Index source anchor:\n%s", label, snapshot)
		}
	}
	if driver.indexLocationBefore.FocusedPane != "detail" {
		t.Fatalf("routed Index focus = %q, want detail", driver.indexLocationBefore.FocusedPane)
	}
	if got := driver.indexLocationBefore.Anchors["detail"]; got == "" {
		t.Fatal("routed Index detail has no authored source anchor")
	} else if got != driver.indexLocationAfter.Anchors["detail"] {
		t.Fatalf("authored source anchor changed across resize: %q -> %q", got, driver.indexLocationAfter.Anchors["detail"])
	}
	if !reflect.DeepEqual(driver.runsLocationAfter, driver.runsLocationBefore) {
		t.Fatalf("Back Runs location mismatch:\n got %#v\nwant %#v", driver.runsLocationAfter, driver.runsLocationBefore)
	}
}
