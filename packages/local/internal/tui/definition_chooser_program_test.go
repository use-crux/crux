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

type definitionChooserProgramClient struct {
	*uitest.FixtureClient
	refs []observability.DefinitionRef
}

func (c *definitionChooserProgramClient) GetJSON(context.Context, string, any) error { return nil }

func newDefinitionChooserProgramClient() *definitionChooserProgramClient {
	refs := make([]observability.DefinitionRef, 20)
	for index := range refs {
		refs[index] = observability.DefinitionRef{
			ID:   fmt.Sprintf("agent:choice-%02d", index+1),
			Kind: "agent",
			Role: "invoke",
			Source: &observability.SanitizedSourceRef{
				File: fmt.Sprintf("src/agent-%02d.ts", index+1), Line: index + 1,
			},
		}
	}
	refs[3].Kind = "agent\x1b]8;;https://evil.invalid\x07linked\x1b]8;;\x07\x00\r"
	refs[3].Role = "route\tmalicious"
	refs[3].Source.File = "src/\x1b[31mevil.ts"
	return &definitionChooserProgramClient{FixtureClient: uitest.NewFixtureClient(), refs: refs}
}

func (c *definitionChooserProgramClient) ObservabilityRunsPage(context.Context, ...string) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Rows: []api.ObservabilityRunSummary{{RunID: "run-definitions", Name: "definitions"}}}, nil
}

func (c *definitionChooserProgramClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	children := make([]api.ObservabilityRunDetailNode, 18)
	for index := range children {
		children[index] = api.ObservabilityRunDetailNode{
			ID: fmt.Sprintf("node-%02d", index+1),
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID: fmt.Sprintf("span-%02d", index+1), ParentSpanID: "span-root", Name: fmt.Sprintf("activity %02d", index+1),
			},
		}
	}
	children[len(children)-1].DefinitionRefs = c.refs
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: runID, Name: "definitions"},
		Root: api.ObservabilityRunDetailNode{
			ID: "root", SpanSummary: api.ObservabilitySpanSummary{SpanID: "span-root", Name: "root"}, Children: children,
		},
		DefinitionRefs: c.refs,
	}, true, nil
}

func (c *definitionChooserProgramClient) ProjectIndex(context.Context) (api.IndexData, error) {
	definitions := make([]api.ProjectDefinition, len(c.refs))
	for index, ref := range c.refs {
		definitions[index] = api.ProjectDefinition{
			ID: ref.ID, Kind: ref.Kind, Name: "duplicate display name", Fidelity: "resolved",
		}
	}
	return api.IndexData{Definitions: definitions}, nil
}

type definitionChooserProgramDriver struct {
	app                *App
	stage              int
	historyAtOpen      int
	pageDownIndex      int
	openSnapshot       string
	selectedExactID    string
	historyAfterEnter  int
	runsLocationBefore screens.ScreenLocation
	runsLocationAfter  screens.ScreenLocation
	err                string
}

func (d *definitionChooserProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *definitionChooserProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	chooser := d.app.workbench.definitionChooser
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
		if pressed, ok := msg.(tea.KeyPressMsg); ok && pressed.String() == "l" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnd}))
		}
	case 2:
		if pressed, ok := msg.(tea.KeyPressMsg); ok && pressed.String() == "end" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "l", Code: 'l'}))
		}
	case 3:
		if pressed, ok := msg.(tea.KeyPressMsg); ok && pressed.String() == "l" {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyPgDown}))
		}
	case 4:
		if pressed, ok := msg.(tea.KeyPressMsg); ok && pressed.String() == "pgdown" {
			runs := d.app.workbench.screens["runs"].(*screens.Runs)
			d.runsLocationBefore = runs.CaptureLocation()
			d.historyAtOpen = len(d.app.workbench.history)
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "d", Code: 'd'}))
		}
	case 5:
		if chooser.IsOpen() {
			d.openSnapshot = ansi.Strip(d.app.View().Content)
			if len(d.app.workbench.history) != d.historyAtOpen {
				return fail("opening chooser changed history")
			}
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "j", Code: 'j'}))
		}
	case 6:
		if pressedKey != "j" {
			break
		}
		if chooser.SelectedID() != "agent:choice-02" {
			return fail("j selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "k", Code: 'k'}))
	case 7:
		if pressedKey != "k" {
			break
		}
		if chooser.SelectedID() != "agent:choice-01" {
			return fail("k selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyDown}))
	case 8:
		if pressedKey != "down" {
			break
		}
		if chooser.SelectedID() != "agent:choice-02" {
			return fail("down selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyUp}))
	case 9:
		if pressedKey != "up" {
			break
		}
		if chooser.SelectedID() != "agent:choice-01" {
			return fail("up selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyPgDown}))
	case 10:
		if pressedKey != "pgdown" {
			break
		}
		d.pageDownIndex = chooser.Position().SelectedIndex
		if d.pageDownIndex <= 0 {
			return fail("page down did not move selection")
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyPgUp}))
	case 11:
		if pressedKey != "pgup" {
			break
		}
		if chooser.SelectedID() != "agent:choice-01" {
			return fail("page up selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnd}))
	case 12:
		if pressedKey != "end" {
			break
		}
		if chooser.SelectedID() != "agent:choice-20" {
			return fail("end selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyHome}))
	case 13:
		if pressedKey != "home" {
			break
		}
		if chooser.SelectedID() != "agent:choice-01" {
			return fail("home selected %q", chooser.SelectedID())
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEscape}))
	case 14:
		if pressedKey != "esc" {
			break
		}
		if chooser.IsOpen() {
			return fail("escape left chooser open")
		}
		if len(d.app.workbench.history) != d.historyAtOpen {
			return fail("escape changed history")
		}
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Text: "d", Code: 'd'}))
	case 15:
		if chooser.IsOpen() {
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnd}))
		}
	case 16:
		if pressedKey != "end" {
			break
		}
		d.selectedExactID = chooser.SelectedID()
		d.stage++
		return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEnter}))
	case 17:
		index := d.app.workbench.screens["index"].(*screens.Index)
		if d.app.workbench.activeTarget == (NavTarget{NavID: "index", Kind: "definition", ID: d.selectedExactID}) &&
			index.SelectedDefinitionID() == d.selectedExactID {
			d.historyAfterEnter = len(d.app.workbench.history)
			d.stage++
			return d, tea.Batch(appCmd, key(tea.KeyPressMsg{Code: tea.KeyEscape}))
		}
	case 18:
		if d.app.workbench.activeNav == "runs" {
			d.runsLocationAfter = d.app.workbench.screens["runs"].(*screens.Runs).CaptureLocation()
			return d, tea.Quit
		}
	}
	return d, appCmd
}

func (d *definitionChooserProgramDriver) View() tea.View { return d.app.View() }

func TestDefinitionChooserIsModalScrollableAndHistoryNeutralThroughRealProgram(t *testing.T) {
	client := newDefinitionChooserProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	driver := &definitionChooserProgramDriver{app: app}

	_, _, err := runTestProgramAtSize(t, driver, "", 70, 24)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.err != "" {
		t.Fatal(driver.err)
	}
	if driver.selectedExactID != "agent:choice-20" {
		t.Fatalf("chooser selected exact ID %q", driver.selectedExactID)
	}
	if driver.historyAfterEnter != driver.historyAtOpen+1 {
		t.Fatalf("confirmed navigation history = %d, want %d", driver.historyAfterEnter, driver.historyAtOpen+1)
	}
	if got := len(app.workbench.history); got != driver.historyAtOpen {
		t.Fatalf("Back history = %d, want original %d", got, driver.historyAtOpen)
	}
	if !reflect.DeepEqual(driver.runsLocationAfter, driver.runsLocationBefore) {
		t.Fatalf("Back Runs location mismatch:\n got %#v\nwant %#v", driver.runsLocationAfter, driver.runsLocationBefore)
	}
	for _, unsafe := range []string{"evil.invalid", "\x00", "\x07", "\r", "\t"} {
		if strings.Contains(driver.openSnapshot, unsafe) {
			t.Fatalf("chooser rendered unsafe metadata %q:\n%s", unsafe, driver.openSnapshot)
		}
	}
	assertTerminalFrameGeometry(t, driver.openSnapshot, 70, 24)
}
