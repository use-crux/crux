package tui

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type overviewInsightsBackDriver struct {
	app               *App
	stage             int
	selectedBefore    string
	selectedAfter     string
	activeNavAfterEsc string
}

func (d *overviewInsightsBackDriver) Init() tea.Cmd { return d.app.Init() }

func (d *overviewInsightsBackDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	overview := d.app.workbench.screens["overview"].(*screens.Overview)
	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if selected := overview.SelectedInsightID(); selected != "" {
			d.selectedBefore = selected
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEnter})
		}
	case 1:
		if d.app.workbench.activeNav == "insights" {
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyEscape})
		}
	case 2:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "esc" {
			d.activeNavAfterEsc = d.app.workbench.activeNav
			d.selectedAfter = overview.SelectedInsightID()
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *overviewInsightsBackDriver) View() tea.View { return d.app.View() }

func TestBackRestoresOverviewAfterInsightDrillThroughRealProgram(t *testing.T) {
	client := uitest.NewFixtureClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	driver := &overviewInsightsBackDriver{app: app}

	if _, _, err := runTestProgram(t, driver, ""); err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.activeNavAfterEsc != "overview" {
		t.Fatalf("Back active nav = %q, want overview", driver.activeNavAfterEsc)
	}
	if driver.selectedAfter != driver.selectedBefore {
		t.Fatalf("Back insight selection = %q, want %q", driver.selectedAfter, driver.selectedBefore)
	}
}
