package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type runsLayoutProgramDriver struct {
	app      *App
	snapshot string
	bodySize screens.Size
}

type runsResizeNavigationDriver struct {
	app      *App
	stage    int
	before   string
	after    string
	bodySize screens.Size
	snapshot string
}

func (d *runsLayoutProgramDriver) Init() tea.Cmd { return d.app.Init() }

func (d *runsLayoutProgramDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, cmd := d.app.Update(msg)
	runs, _ := d.app.workbench.activeScreen().(*screens.Runs)
	if runs != nil && runs.SelectedSpanID() != "" {
		d.snapshot = ansi.Strip(d.app.View().Content)
		d.bodySize = d.app.workbench.activeScreenBodySize()
		return d, tea.Quit
	}
	return d, cmd
}

func (d *runsLayoutProgramDriver) View() tea.View { return d.app.View() }

func (d *runsResizeNavigationDriver) Init() tea.Cmd { return d.app.Init() }

func (d *runsResizeNavigationDriver) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	_, appCmd := d.app.Update(msg)
	runs, _ := d.app.workbench.activeScreen().(*screens.Runs)
	var driverCmd tea.Cmd
	switch d.stage {
	case 0:
		if runs != nil && runs.SelectedSpanID() != "" {
			d.before = runs.SelectedSpanID()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Text: "l", Code: 'l'})
		}
	case 1:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "l" {
			d.stage++
			driverCmd = func() tea.Msg { return tea.WindowSizeMsg{Width: 100, Height: 30} }
		}
	case 2:
		if _, ok := msg.(tea.WindowSizeMsg); ok {
			d.bodySize = d.app.workbench.activeScreenBodySize()
			d.stage++
			driverCmd = keyCommand(tea.KeyPressMsg{Code: tea.KeyPgDown})
		}
	case 3:
		if key, ok := msg.(tea.KeyPressMsg); ok && key.String() == "pgdown" {
			d.after = runs.SelectedSpanID()
			d.snapshot = ansi.Strip(d.app.View().Content)
			return d, tea.Quit
		}
	}
	return d, tea.Batch(appCmd, driverCmd)
}

func (d *runsResizeNavigationDriver) View() tea.View { return d.app.View() }

func newRunsLayoutProgramDriver() *runsLayoutProgramDriver {
	client := newRunsDocumentProgramClient()
	app := newTestApp("http://localhost:4400", client, "", false)
	app.MarkBootComplete()
	app.workbench.activeNav = "runs"
	app.workbench.activeTarget = NavTarget{NavID: "runs"}
	return &runsLayoutProgramDriver{app: app}
}

func TestRunsNarrowLayoutThroughRealProgram(t *testing.T) {
	driver := newRunsLayoutProgramDriver()
	_, _, err := runTestProgramAtSize(t, driver, "", 70, 24)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.bodySize != (screens.Size{Width: 70, Height: 21}) {
		t.Fatalf("Runs body size = %+v, want 70x21 after Workbench chrome", driver.bodySize)
	}
	assertTerminalFrameGeometry(t, driver.snapshot, 70, 24)
	if !strings.Contains(driver.snapshot, "document scroll fixture") {
		t.Fatalf("narrow layout hid selected run:\n%s", driver.snapshot)
	}
	for _, hidden := range []string{"hierarchy row", "RUN SUMMARY"} {
		if strings.Contains(driver.snapshot, hidden) {
			t.Fatalf("narrow layout overlapped secondary content %q:\n%s", hidden, driver.snapshot)
		}
	}
}

func TestRunsMediumLayoutPrioritizesReadableDiagnosisThroughRealProgram(t *testing.T) {
	driver := newRunsLayoutProgramDriver()
	_, _, err := runTestProgramAtSize(t, driver, "", 100, 30)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.bodySize != (screens.Size{Width: 81, Height: 27}) {
		t.Fatalf("Runs body size = %+v, want 81x27 after Workbench chrome", driver.bodySize)
	}
	assertTerminalFrameGeometry(t, driver.snapshot, 100, 30)
	for _, visible := range []string{"run-doc", "RUN SUMMARY", "failed"} {
		if !strings.Contains(driver.snapshot, visible) {
			t.Fatalf("medium layout omitted readable selected-run evidence %q:\n%s", visible, driver.snapshot)
		}
	}
	if strings.Contains(driver.snapshot, "hierarchy row 19") {
		t.Fatalf("medium layout overlapped a full secondary hierarchy into diagnosis:\n%s", driver.snapshot)
	}
}

func TestRunsBelowMinimumIsActionableThroughRealProgram(t *testing.T) {
	driver := newRunsLayoutProgramDriver()
	_, _, err := runTestProgramAtSize(t, driver, "", 59, 19)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.bodySize != (screens.Size{Width: 59, Height: 16}) {
		t.Fatalf("Runs body size = %+v, want 59x16 after Workbench chrome", driver.bodySize)
	}
	assertTerminalFrameGeometry(t, driver.snapshot, 59, 19)
	for _, visible := range []string{"terminal too small", "60×20"} {
		if !strings.Contains(strings.ToLower(driver.snapshot), strings.ToLower(visible)) {
			t.Fatalf("below-minimum layout omitted actionable message %q:\n%s", visible, driver.snapshot)
		}
	}
	if strings.Contains(driver.snapshot, "hierarchy row") {
		t.Fatalf("below-minimum layout rendered overlapping normal content:\n%s", driver.snapshot)
	}
}

func TestRunsWideLayoutShowsAllReadablePanesThroughRealProgram(t *testing.T) {
	driver := newRunsLayoutProgramDriver()
	_, _, err := runTestProgramAtSize(t, driver, "", 160, 45)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.bodySize != (screens.Size{Width: 141, Height: 42}) {
		t.Fatalf("Runs body size = %+v, want 141x42 after Workbench chrome", driver.bodySize)
	}
	assertTerminalFrameGeometry(t, driver.snapshot, 160, 45)
	for _, visible := range []string{"run-doc", "hierarchy row 00", "RUN SUMMARY"} {
		if !strings.Contains(driver.snapshot, visible) {
			t.Fatalf("wide layout omitted pane content %q:\n%s", visible, driver.snapshot)
		}
	}
}

func TestRunsResizeReachesFocusedPaneBeforeNavigationThroughRealProgram(t *testing.T) {
	base := newRunsLayoutProgramDriver()
	driver := &runsResizeNavigationDriver{app: base.app}
	_, _, err := runTestProgramAtSize(t, driver, "", 70, 24)
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if driver.bodySize != (screens.Size{Width: 81, Height: 27}) {
		t.Fatalf("Runs body size before navigation = %+v, want resized 81x27", driver.bodySize)
	}
	if driver.before == "" || driver.after == driver.before {
		t.Fatalf("selection after resized page navigation = %q, want change from %q", driver.after, driver.before)
	}
	if !strings.Contains(driver.snapshot, "hierarchy row 18") {
		t.Fatalf("resized pane did not keep its selected last row visible:\n%s", driver.snapshot)
	}
	assertTerminalFrameGeometry(t, driver.snapshot, 100, 30)
}

func assertTerminalFrameGeometry(t *testing.T, frame string, width, height int) {
	t.Helper()
	lines := strings.Split(frame, "\n")
	if len(lines) != height {
		t.Fatalf("frame height = %d, want %d", len(lines), height)
	}
	for index, line := range lines {
		if got := lipgloss.Width(line); got != width {
			t.Fatalf("frame line %d width = %d, want %d:\n%s", index, got, width, fmt.Sprintf("%q", line))
		}
	}
}
