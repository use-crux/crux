package tui

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/overlays"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

var contractStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

var (
	borderForeground  = firstCellStyle(contractStyles.Border.Render("x")).Foreground
	bodyBackground    = firstCellStyle(contractStyles.SurfaceBody.Render("x")).Background
	railBackground    = firstCellStyle(contractStyles.SurfaceRail.Render("x")).Background
	bandBackground    = firstCellStyle(contractStyles.SurfaceBand.Render("x")).Background
	overlayBackground = firstCellStyle(contractStyles.SurfaceOverlay.Render("x")).Background
)

func TestRegisteredScreensHonorSurfaceContract(t *testing.T) {
	for _, screenID := range registeredFixtureScreenIDs(t) {
		t.Run(screenID, func(t *testing.T) {
			workbench := fixtureWorkbenchAtScreen(t, screenID)
			for _, size := range []struct{ width, height int }{{160, 45}, {100, 30}, {70, 24}} {
				name := fmt.Sprintf("%dx%d", size.width, size.height)
				t.Run(name, func(t *testing.T) {
					workbench.Resize(size.width, size.height)
					frame := workbench.View()
					assertDeclaredSurfaces(t, screenID, size.width, size.height, frame)
					assertRuleStyles(t, screenID, size.width, frame)
				})
			}
		})
	}
}

func TestRegisteredScreensHonorJunctionContract(t *testing.T) {
	for _, screenID := range registeredFixtureScreenIDs(t) {
		t.Run(screenID, func(t *testing.T) {
			workbench := fixtureWorkbenchAtScreen(t, screenID)
			for _, size := range []struct{ width, height int }{{160, 45}, {100, 30}, {70, 24}} {
				workbench.Resize(size.width, size.height)
				assertJunctions(t, fmt.Sprintf("%s-%dx%d", screenID, size.width, size.height), workbench.View())
			}
			uitest.FuzzResize(t, func(width, height int) string {
				workbench.Resize(width, height)
				frame := workbench.View()
				assertJunctions(t, fmt.Sprintf("%s-%dx%d", screenID, width, height), frame)
				assertRuleStyles(t, screenID, width, frame)
				return frame
			})
		})
	}
}

func TestOverlaysHonorRuleStyleContract(t *testing.T) {
	palette := overlays.NewPalette()
	palette.Open()
	help := overlays.NewHelp()
	help.SetScreenKeybinds("runs", []shell.Keybind{shell.Bind("j/k", "move")})
	help.Open()
	inspect := overlays.NewInspect()
	inspect.Open("span retrieve", "8af2f1c", json.RawMessage(`{"query":"typed prompts","hits":4}`))

	for name, frame := range map[string]string{
		"palette": palette.View(160, 45),
		"help":    help.View(160, 45),
		"inspect": inspect.View(160, 45),
	} {
		t.Run(name, func(t *testing.T) {
			assertRuleStylesOnSurface(t, frame, overlayBackground)
		})
	}
}

func TestWorkbenchOverlaysHonorRuleStyleContract(t *testing.T) {
	tests := map[string]func(*Workbench){
		"palette": func(workbench *Workbench) { workbench.palette.Open() },
		"help": func(workbench *Workbench) {
			workbench.help.SetScreenKeybinds("overview", []shell.Keybind{shell.Bind("j/k", "move")})
			workbench.help.Open()
		},
		"inspect": func(workbench *Workbench) {
			workbench.inspect.Open("span retrieve", "8af2f1c", json.RawMessage(`{"query":"typed prompts","hits":4}`))
		},
		"definition-chooser": func(workbench *Workbench) {
			workbench.definitionChooser.Open([]screens.DefinitionChoice{{ID: "prompt:answer"}, {ID: "agent:support"}})
		},
	}
	for name, open := range tests {
		t.Run(name, func(t *testing.T) {
			workbench := fixtureWorkbenchAtScreen(t, "overview")
			workbench.Resize(160, 45)
			open(workbench)
			frame := workbench.View()
			assertRuleStyles(t, "overview", 160, frame)
			assertRoundedRuleStylesOnSurface(t, frame, overlayBackground)
		})
	}
}

func TestReconcileBordersHonorsActiveThemeProfile(t *testing.T) {
	profiles := []struct {
		name    string
		profile colorprofile.Profile
	}{
		{"truecolor", colorprofile.TrueColor},
		{"ansi256", colorprofile.ANSI256},
		{"ansi", colorprofile.ANSI},
	}
	for _, test := range profiles {
		t.Run(test.name, func(t *testing.T) {
			styles := theme.NewStyles(theme.Resolve(test.profile))
			frame := styles.SurfaceRail.Render("│") + " " + styles.SurfaceBody.Render("│")
			got := kit.ReconcileBordersStyled(frame, styles)
			cells := uitest.CellStyles(got)
			wantForeground := firstCellStyle(styles.Border.Render("x")).Foreground
			wantRail := firstCellStyle(styles.SurfaceRail.Render("x")).Background
			wantBody := firstCellStyle(styles.SurfaceBody.Render("x")).Background
			for _, cell := range []struct {
				x          int
				background string
			}{{0, wantRail}, {2, wantBody}} {
				if got := cells[cell.x]; got.Foreground != wantForeground || got.Background != cell.background {
					t.Fatalf("cell %d style = %#v, want foreground %q background %q", cell.x, got, wantForeground, cell.background)
				}
			}
		})
	}
}

func registeredFixtureScreenIDs(t *testing.T) []string {
	t.Helper()
	client := programFixtureClient{uitest.NewFixtureClient()}
	workbench := newTestWorkbench(client, client, "http://localhost:4850")
	ids := make([]string, 0, len(workbench.screens))
	for id := range workbench.screens {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func fixtureWorkbenchAtScreen(t *testing.T, screenID string) *Workbench {
	t.Helper()
	client := programFixtureClient{uitest.NewFixtureClient()}
	workbench := newTestWorkbench(client, client, "http://localhost:4850")
	workbench.Resize(160, 45)
	runWorkbenchCommands(workbench, workbench.Init())
	if screenID != workbench.activeNav {
		runWorkbenchCommands(workbench, workbench.gotoNav(screenID))
	}
	return workbench
}

func assertDeclaredSurfaces(t *testing.T, screenID string, width, height int, frame string) {
	t.Helper()
	rows := strings.Split(frame, "\n")
	if len(rows) != height {
		t.Fatalf("frame has %d rows, want %d", len(rows), height)
	}
	if kit.Classify(width) != kit.LayoutSingle {
		for row, line := range rows {
			assertUniformBackground(t, line, row, 0, shell.NavRailWidth, railBackground, "rail")
		}
	}
	if screenID == "overview" && kit.Classify(width) != kit.LayoutSingle {
		left := shell.NavRailWidth + 1
		for row := 2; row < 7; row++ {
			assertUniformBackground(t, rows[row], row, left, width, bandBackground, "KPI band")
		}
	}
}

func assertUniformBackground(t *testing.T, line string, row, start, end int, want, region string) {
	t.Helper()
	spans := uitest.BackgroundSpans(line)
	for cell := start; cell < end; cell++ {
		got := ""
		for _, span := range spans {
			if cell >= span.Start && cell < span.End {
				got = span.Color
				break
			}
		}
		if got != want {
			t.Fatalf("%s row %d cell %d background = %q, want %q; spans=%#v", region, row, cell, got, want, spans)
		}
	}
}

func assertRuleStyles(t *testing.T, screenID string, width int, frame string) {
	t.Helper()
	for y, line := range strings.Split(frame, "\n") {
		plain := ansi.Strip(line)
		styles := uitest.CellStyles(line)
		x := 0
		for _, glyph := range plain {
			if isRuleGlyph(glyph) {
				wantBackground := bodyBackground
				if kit.Classify(width) != kit.LayoutSingle && x < shell.NavRailWidth {
					wantBackground = railBackground
				}
				if screenID == "overview" && overviewUsesBand(width) &&
					y >= 2 && y < 7 && x > shell.NavRailWidth {
					wantBackground = bandBackground
				}
				assertRuleCellStyle(t, frame, x, y, glyph, styles, wantBackground)
			}
			x += lipgloss.Width(string(glyph))
		}
	}
}

func overviewUsesBand(frameWidth int) bool {
	if kit.Classify(frameWidth) == kit.LayoutSingle {
		return false
	}
	return kit.Classify(frameWidth-shell.NavRailWidth-1) != kit.LayoutSingle
}

func assertRuleStylesOnSurface(t *testing.T, frame, wantBackground string) {
	t.Helper()
	for y, line := range strings.Split(frame, "\n") {
		styles := uitest.CellStyles(line)
		x := 0
		for _, glyph := range ansi.Strip(line) {
			if isRuleGlyph(glyph) {
				assertRuleCellStyle(t, frame, x, y, glyph, styles, wantBackground)
			}
			x += lipgloss.Width(string(glyph))
		}
	}
}

func assertRoundedRuleStylesOnSurface(t *testing.T, frame, wantBackground string) {
	t.Helper()
	found := 0
	for y, line := range strings.Split(frame, "\n") {
		styles := uitest.CellStyles(line)
		x := 0
		for _, glyph := range ansi.Strip(line) {
			if strings.ContainsRune("╭╮╰╯", glyph) {
				assertRuleCellStyle(t, frame, x, y, glyph, styles, wantBackground)
				found++
			}
			x += lipgloss.Width(string(glyph))
		}
	}
	if found == 0 {
		t.Fatal("overlay frame has no rounded border cells")
	}
}

func assertRuleCellStyle(t *testing.T, frame string, x, y int, glyph rune, styles []uitest.CellStyle, wantBackground string) {
	t.Helper()
	if x >= len(styles) {
		t.Fatalf("rule %q at (%d,%d) has no computed ANSI style", glyph, x, y)
	}
	got := styles[x]
	if got.Foreground != borderForeground {
		t.Fatalf("rule %q at (%d,%d) foreground = %q, want %q:\n%s", glyph, x, y, got.Foreground, borderForeground, junctionContext(frame, y))
	}
	if got.Background != wantBackground {
		t.Fatalf("rule %q at (%d,%d) background = %q, want %q:\n%s", glyph, x, y, got.Background, wantBackground, junctionContext(frame, y))
	}
}

func isRuleGlyph(glyph rune) bool {
	return strings.ContainsRune("─│┌┐└┘├┤┬┴┼╭╮╰╯", glyph)
}

func firstCellStyle(value string) uitest.CellStyle {
	styles := uitest.CellStyles(value)
	if len(styles) == 0 {
		return uitest.CellStyle{}
	}
	return styles[0]
}

type frameCell struct{ x, y int }

// Any future exception must name one exact rendered frame coordinate and its
// reason. The contract currently has no exceptions.
var junctionExceptions = map[string]map[frameCell]string{}

func assertJunctions(t *testing.T, frameName, frame string) {
	t.Helper()
	grid := plainCellGrid(frame)
	frameWidth := lipgloss.Width(strings.Split(ansi.Strip(frame), "\n")[0])
	for y, row := range grid {
		for x, glyph := range row {
			coord := frameCell{x: x, y: y}
			if _, allowed := junctionExceptions[frameName][coord]; allowed {
				continue
			}
			switch glyph {
			case '│':
				above := rune(0)
				if y > 0 {
					above = grid[y-1][x]
				}
				below := grid[y+1][x]
				if above == '─' || below == '─' {
					t.Fatalf("%s has a vertical rule meeting a horizontal rule without a junction at (%d,%d)", frameName, x, y)
				}
				if x > 0 && x < frameWidth-1 && y > 0 && !connectsDown(above) {
					t.Fatalf("%s has a vertical rule floating at its top endpoint (%d,%d):\n%s", frameName, x, y, junctionContext(frame, y))
				}
				if x > 0 && x < frameWidth-1 && y < len(grid)-2 && !connectsUp(below) {
					t.Fatalf("%s has a vertical rule floating at its bottom endpoint (%d,%d):\n%s", frameName, x, y, junctionContext(frame, y))
				}
			case '─':
				if row[x-1] == '│' || row[x+1] == '│' {
					t.Fatalf("%s has a horizontal rule abutting a vertical rule without a junction at (%d,%d)", frameName, x, y)
				}
			}
		}
		if y > 0 && allRuleRow(grid[y-1]) && allRuleRow(row) {
			plain := strings.Split(ansi.Strip(frame), "\n")
			t.Fatalf("%s has doubled horizontal rules on rows %d and %d:\n%s\n%s", frameName, y-1, y, plain[y-1], plain[y])
		}
	}
}

func junctionContext(frame string, row int) string {
	lines := strings.Split(ansi.Strip(frame), "\n")
	start, end := max(0, row-1), min(len(lines), row+2)
	return strings.Join(lines[start:end], "\n")
}

func connectsDown(glyph rune) bool {
	return strings.ContainsRune("│┌┐├┤┬┼", glyph)
}

func connectsUp(glyph rune) bool {
	return strings.ContainsRune("│└┘├┤┴┼", glyph)
}

func plainCellGrid(frame string) []map[int]rune {
	lines := strings.Split(ansi.Strip(frame), "\n")
	grid := make([]map[int]rune, len(lines)+1)
	for index := range grid {
		grid[index] = map[int]rune{}
	}
	for y, line := range lines {
		x := 0
		for _, glyph := range line {
			grid[y][x] = glyph
			x += lipgloss.Width(string(glyph))
		}
	}
	return grid
}

func allRuleRow(row map[int]rune) bool {
	rules := 0
	for _, glyph := range row {
		if glyph == ' ' {
			continue
		}
		switch glyph {
		case '─', '┬', '┴', '├', '┤', '┼':
			rules++
		default:
			return false
		}
	}
	return rules >= 4
}
