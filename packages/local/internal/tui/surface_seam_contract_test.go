package tui

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

const railBackground = "rgb:16,22,20"

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
			assertUniformBackground(t, rows[row], row, left, width, railBackground, "KPI band")
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
