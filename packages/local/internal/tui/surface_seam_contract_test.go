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
	railBackground = firstCellStyle(contractStyles.SurfaceRail.Render("x")).Background
	bandBackground = firstCellStyle(contractStyles.SurfaceBand.Render("x")).Background
)

var contractProfiles = []struct {
	name   string
	styles theme.Styles
}{
	{"truecolor", theme.NewStyles(theme.Resolve(colorprofile.TrueColor))},
	{"ansi256", theme.NewStyles(theme.Resolve(colorprofile.ANSI256))},
	{"ansi", theme.NewStyles(theme.Resolve(colorprofile.ANSI))},
}

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
				return frame
			})
		})
	}
}

func TestRegisteredScreensHonorRuleStyleContract(t *testing.T) {
	for _, profile := range contractProfiles {
		t.Run(profile.name, func(t *testing.T) {
			t.Parallel()
			for _, screenID := range registeredFixtureScreenIDs(t) {
				t.Run(screenID, func(t *testing.T) {
					t.Parallel()
					assertRuleStyleMatrix(t, fixtureWorkbenchAtScreen(t, screenID), profile.styles)
				})
			}
		})
	}
}

func TestOverlaysHonorRuleStyleContract(t *testing.T) {
	overlayCases := map[string]func() func(int, int) string{
		"palette": func() func(int, int) string {
			overlay := overlays.NewPalette()
			overlay.Open()
			return overlay.View
		},
		"help": func() func(int, int) string {
			overlay := overlays.NewHelp()
			overlay.SetScreenKeybinds("overview", []shell.Keybind{shell.Bind("j/k", "move")})
			overlay.Open()
			return overlay.View
		},
		"inspect": func() func(int, int) string {
			overlay := overlays.NewInspect()
			overlay.Open("span retrieve", "8af2f1c", json.RawMessage(`{"query":"typed prompts","hits":4}`))
			return overlay.View
		},
		"definition-chooser": func() func(int, int) string {
			overlay := newDefinitionChooser()
			overlay.Open([]screens.DefinitionChoice{{ID: "prompt:answer"}, {ID: "agent:support"}})
			return func(width, height int) string {
				overlay.Resize(width, height)
				return overlay.View()
			}
		},
	}
	for _, profile := range contractProfiles {
		t.Run(profile.name, func(t *testing.T) {
			t.Parallel()
			for name, newView := range overlayCases {
				t.Run(name, func(t *testing.T) {
					t.Parallel()
					assertRuleFrameMatrix(t, newView(), profile.styles)
				})
			}
		})
	}
}

func TestReconcileBordersHonorsActiveThemeProfile(t *testing.T) {
	for _, profile := range contractProfiles {
		t.Run(profile.name, func(t *testing.T) {
			frame := profile.styles.SurfaceRail.Render("│x") + " │x"
			got := kit.ReconcileBordersStyled(frame, profile.styles)
			cells := uitest.CellStyles(got)
			wantForeground := firstCellStyle(profile.styles.Border.Render("x")).Foreground
			for _, cell := range []struct{ rule, neighbor int }{{0, 1}, {3, 4}} {
				if got := cells[cell.rule]; got.Foreground != wantForeground || got.Background != cells[cell.neighbor].Background {
					t.Fatalf("cell %d style = %#v, want foreground %q and neighbor %d background %q", cell.rule, got, wantForeground, cell.neighbor, cells[cell.neighbor].Background)
				}
			}
		})
	}
}

func assertRuleStyleMatrix(t *testing.T, workbench *Workbench, styles theme.Styles) {
	t.Helper()
	assertRuleFrameMatrix(t, func(width, height int) string {
		workbench.Resize(width, height)
		return workbench.View()
	}, styles)
}

func assertRuleFrameMatrix(t *testing.T, render func(int, int) string, styles theme.Styles) {
	t.Helper()
	wantForeground := firstCellStyle(styles.Border.Render("x")).Foreground
	assertFrame := func(t *testing.T, width, height int) string {
		t.Helper()
		frame := kit.ReconcileBordersStyled(render(width, height), styles)
		assertRuleStyles(t, frame, wantForeground)
		return frame
	}
	for _, size := range []struct{ width, height int }{{160, 45}, {100, 30}, {70, 24}} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			assertFrame(t, size.width, size.height)
		})
	}
	uitest.FuzzResize(t, func(width, height int) string {
		return assertFrame(t, width, height)
	})
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

func assertRuleStyles(t *testing.T, frame, wantForeground string) {
	t.Helper()
	grid := styledCellGrid(frame)
	for y, row := range grid {
		for x, cell := range row {
			if !isRuleGlyph(cell.glyph) {
				continue
			}
			if cell.style.Foreground != wantForeground {
				t.Fatalf("rule %q at (%d,%d) foreground = %q, want %q:\n%s", cell.glyph, x, y, cell.style.Foreground, wantForeground, junctionContext(frame, y))
			}
			neighbors := ruleNeighbors(grid, x, y, cell.glyph)
			if !matchesNeighborBackground(cell.style.Background, neighbors) {
				t.Fatalf("rule %q at (%d,%d) background = %q, adjacent backgrounds are %s:\n%s", cell.glyph, x, y, cell.style.Background, formatNeighbors(neighbors), junctionContext(frame, y))
			}
		}
	}
}

type styledCell struct {
	x, y  int
	glyph rune
	style uitest.CellStyle
}

func styledCellGrid(frame string) [][]styledCell {
	lines := strings.Split(frame, "\n")
	grid := make([][]styledCell, len(lines))
	for y, line := range lines {
		styles := uitest.CellStyles(line)
		x := 0
		for _, glyph := range ansi.Strip(line) {
			width := lipgloss.Width(string(glyph))
			for column := range width {
				grid[y] = append(grid[y], styledCell{x: x + column, y: y, glyph: glyph, style: styles[x+column]})
			}
			x += width
		}
	}
	return grid
}

func ruleNeighbors(grid [][]styledCell, x, y int, glyph rune) []styledCell {
	directions := [][2]int{{-1, 0}, {1, 0}, {-1, -1}, {1, -1}, {-1, 1}, {1, 1}}
	if glyph == '─' {
		directions = [][2]int{{0, -1}, {0, 1}, {-1, -1}, {1, -1}, {-1, 1}, {1, 1}}
	} else if glyph != '│' {
		directions = [][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}, {-1, -1}, {1, -1}, {-1, 1}, {1, 1}}
	}
	neighbors := make([]styledCell, 0, len(directions))
	for _, direction := range directions {
		nx, ny := x+direction[0], y+direction[1]
		if ny < 0 || ny >= len(grid) || nx < 0 || nx >= len(grid[ny]) {
			continue
		}
		neighbor := grid[ny][nx]
		if !isRuleGlyph(neighbor.glyph) {
			neighbors = append(neighbors, neighbor)
		}
	}
	return neighbors
}

func matchesNeighborBackground(background string, neighbors []styledCell) bool {
	for _, neighbor := range neighbors {
		if background == neighbor.style.Background {
			return true
		}
	}
	return len(neighbors) == 0
}

func formatNeighbors(neighbors []styledCell) string {
	parts := make([]string, 0, len(neighbors))
	for _, neighbor := range neighbors {
		parts = append(parts, fmt.Sprintf("(%d,%d)=%q", neighbor.x, neighbor.y, neighbor.style.Background))
	}
	return strings.Join(parts, ", ")
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
