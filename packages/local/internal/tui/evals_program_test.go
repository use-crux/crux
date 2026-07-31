package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type evalsProgramDriver struct {
	app         *App
	stage       int
	cursorMoved bool
	err         string
}

func (driver *evalsProgramDriver) Init() tea.Cmd { return driver.app.Init() }

func (driver *evalsProgramDriver) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	_, appCommand := driver.app.Update(message)
	key := func(value string) tea.Cmd {
		if value == "tab" {
			return keyCommand(tea.KeyPressMsg{Code: tea.KeyTab})
		}
		return keyCommand(tea.KeyPressMsg{Text: value, Code: rune(value[0])})
	}
	fail := func(format string, values ...any) (tea.Model, tea.Cmd) {
		driver.err = fmt.Sprintf(format, values...)
		return driver, tea.Quit
	}

	view := ansi.Strip(driver.app.View().Content)
	switch driver.stage {
	case 0:
		driver.stage++
		return driver, tea.Batch(appCommand, key("5"))
	case 1:
		if driver.app.workbench.activeNav == "evals" &&
			strings.Contains(view, "demo.support-quality") &&
			strings.Contains(view, "tab focus grid") {
			driver.stage++
			return driver, tea.Batch(appCommand, key("tab"))
		}
	case 2:
		if strings.Contains(view, "refund-window × current") {
			driver.stage++
			return driver, tea.Batch(appCommand, key("j"))
		}
	case 3:
		if strings.Contains(view, "address-change × current") &&
			strings.Contains(view, "8af2f1c · Enter to open") {
			driver.cursorMoved = true
			driver.stage++
			return driver, tea.Batch(appCommand, key("enter"))
		}
	case 4:
		want := NavTarget{NavID: "runs", Kind: KindRun, ID: "8af2f1c"}
		if driver.app.workbench.activeTarget == want {
			return driver, tea.Quit
		}
		if driver.app.workbench.activeNav == "runs" {
			return fail("Runs target = %#v, want %#v", driver.app.workbench.activeTarget, want)
		}
	}
	return driver, appCommand
}

func (driver *evalsProgramDriver) View() tea.View { return driver.app.View() }

func TestEvalsNumericNavGridCursorAndExactRunJumpThroughRealProgram(t *testing.T) {
	client := uitest.NewFixtureClient()
	app := newTestApp("http://localhost:4810", client, "", false)
	app.MarkBootComplete()
	driver := &evalsProgramDriver{app: app}

	if _, _, err := runTestProgramAtSize(t, driver, "", 100, 30); err != nil {
		t.Fatalf("run app at stage %d (nav %s): %v\n%s", driver.stage, app.workbench.activeNav, err, ansi.Strip(app.View().Content))
	}
	if driver.err != "" {
		t.Fatal(driver.err)
	}
	if driver.stage != 4 || !driver.cursorMoved {
		t.Fatalf("program stopped at stage %d (cursor moved %v)", driver.stage, driver.cursorMoved)
	}
}
