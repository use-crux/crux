package tui

import (
	"context"
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

const lastScrollableDefinitionID = "prompt:definition-30"

type indexScrollableClient struct {
	*overviewRunsProgramClient
}

func newIndexScrollableClient() *indexScrollableClient {
	return &indexScrollableClient{overviewRunsProgramClient: newOverviewRunsProgramClient()}
}

func (c *indexScrollableClient) ProjectIndex(context.Context) (api.IndexData, error) {
	definitions := make([]api.ProjectDefinition, 30)
	for i := range definitions {
		definitions[i] = api.ProjectDefinition{
			ID:       fmt.Sprintf("prompt:definition-%02d", i+1),
			Kind:     "prompt",
			Name:     fmt.Sprintf("definition-%02d", i+1),
			Fidelity: "resolved",
		}
	}
	sourceLines := make([]string, 80)
	for i := range sourceLines {
		sourceLines[i] = fmt.Sprintf("source-line-%02d", i+1)
	}
	definitions[0].SourceSnippet = &api.SourceSnippet{
		Source: strings.Join(sourceLines, "\n"),
		Range:  api.SourceRange{File: "src/definition-01.ts", StartLine: 1},
	}
	return api.IndexData{Definitions: definitions}, nil
}

type indexListProgramDriver struct {
	app   *App
	stage int
	moves int
}

type indexAliasProgramDriver struct {
	app                *App
	stage              int
	detailFocused      bool
	detailPaged        bool
	detailPageRestored bool
	listFocused        bool
	listPagedID        string
}

func (d *indexAliasProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *indexAliasProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	var driverCmd tea.Cmd
	index := d.app.workbench.screens["index"].(*screens.Index)
	switch d.stage {
	case 0:
		if d.app.ready {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "g", Code: 'g'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "g" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "p", Code: 'p'})
		}
	case 2:
		if d.app.workbench.activeNav == "index" && index.SelectedDefinitionID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyTab})
		}
	case 3:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "tab" {
			d.detailFocused = strings.Contains(ansi.Strip(d.app.workbench.View()), "▸ definition-01")
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl})
		}
	case 4:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "ctrl+d" {
			d.detailPaged = strings.Contains(ansi.Strip(d.app.workbench.View()), "source-line-20")
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: 'u', Mod: tea.ModCtrl})
		}
	case 5:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "ctrl+u" {
			d.detailPageRestored = strings.Contains(ansi.Strip(d.app.workbench.View()), "source-line-01")
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift})
		}
	case 6:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "shift+tab" {
			d.listFocused = strings.Contains(ansi.Strip(d.app.workbench.View()), "▸ Definitions")
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl})
		}
	case 7:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "ctrl+d" {
			d.listPagedID = index.SelectedDefinitionID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: 'u', Mod: tea.ModCtrl})
		}
	case 8:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "ctrl+u" {
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *indexAliasProgramDriver) View() tea.View { return d.app.View() }

func TestIndexTabTraversalAndControlPagingThroughRealWorkbench(t *testing.T) {
	client := newIndexScrollableClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &indexAliasProgramDriver{app: app}

	_, _, err := runTestProgramAtSize(t, driver, "", 100, 30)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if !driver.detailFocused || !driver.detailPaged || !driver.detailPageRestored || !driver.listFocused {
		t.Fatalf("alias path detailFocused=%t detailPaged=%t detailRestored=%t listFocused=%t", driver.detailFocused, driver.detailPaged, driver.detailPageRestored, driver.listFocused)
	}
	if driver.listPagedID == "" || driver.listPagedID == "prompt:definition-01" {
		t.Fatalf("ctrl+d did not page the focused definition list: %q", driver.listPagedID)
	}
	if got := app.workbench.screens["index"].(*screens.Index).SelectedDefinitionID(); got != "prompt:definition-01" {
		t.Fatalf("ctrl+u did not restore the first definition: %q", got)
	}
}

type indexLayoutProgramDriver struct {
	app   *App
	stage int
}

func (d *indexLayoutProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *indexLayoutProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if d.app.ready {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "g", Code: 'g'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "g" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "p", Code: 'p'})
		}
	case 2:
		index := d.app.workbench.screens["index"].(*screens.Index)
		if d.app.workbench.activeNav == "index" && index.SelectedDefinitionID() != "" {
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *indexLayoutProgramDriver) View() tea.View { return d.app.View() }

func TestIndexRealWorkbenchFramesAtSplitSizes(t *testing.T) {
	for _, size := range []struct{ width, height int }{{100, 30}, {160, 45}} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			client := newIndexScrollableClient()
			app := newTestApp("http://localhost:4400", client, "", false)
			app.MarkBootComplete()
			driver := &indexLayoutProgramDriver{app: app}

			_, _, err := runTestProgramAtSize(t, driver, "", size.width, size.height)
			if err != nil {
				t.Fatalf("run app: %v", err)
			}
			view := app.workbench.View()
			lines := strings.Split(view, "\n")
			if len(lines) != size.height {
				t.Fatalf("frame lines = %d, want %d", len(lines), size.height)
			}
			for lineIndex, line := range lines {
				if width := lipgloss.Width(line); width != size.width {
					t.Fatalf("line %d width = %d, want %d", lineIndex+1, width, size.width)
				}
			}
			plain := ansi.Strip(view)
			for _, want := range []string{"Definitions", "SOURCE SNIPPET", "source-line-01"} {
				if !strings.Contains(plain, want) {
					t.Fatalf("split frame omitted %q:\n%s", want, plain)
				}
			}
		})
	}
}

func (d *indexListProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *indexListProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if !d.app.ready {
			break
		}
		d.stage++
		driverCmd = keyCommand(tea.KeyPressMsg{Text: "g", Code: 'g'})
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "g" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "p", Code: 'p'})
		}
	case 2:
		index := d.app.workbench.screens["index"].(*screens.Index)
		if d.app.workbench.activeNav == "index" && index.SelectedDefinitionID() != "" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "j", Code: 'j'})
		}
	case 3:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "j" {
			d.moves++
			if d.moves == 29 {
				return d, tea.Quit
			}
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "j", Code: 'j'})
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *indexListProgramDriver) View() tea.View { return d.app.View() }

func TestIndexKeepsOffscreenSelectionVisibleThroughRealWorkbench(t *testing.T) {
	client := newIndexScrollableClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &indexListProgramDriver{app: app}

	_, _, err := runTestProgramAtSize(t, driver, "", 70, 24)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	index := app.workbench.screens["index"].(*screens.Index)
	if got := index.SelectedDefinitionID(); got != lastScrollableDefinitionID {
		t.Fatalf("Index selection = %q, want %q", got, lastScrollableDefinitionID)
	}

	view := ansi.Strip(app.workbench.View())
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, "definition-30") && strings.Contains(line, "▌") {
			return
		}
	}
	t.Fatalf("selected definition is outside the visible list viewport:\n%s", view)
}
