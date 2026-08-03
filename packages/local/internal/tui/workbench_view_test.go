package tui

import (
	"math/rand"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// TestWorkbenchViewHasNoTabStrip asserts the top tab strip is gone from
// the rendered TUI. The four-section tab strip (`quality · traces · eval
// · shell`) was superseded by the unified breadcrumb-with-status row
// (see plans/tui-v1-quality-workbench-implementation.md S2).
func TestWorkbenchViewHasNoTabStrip(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	out := w.View()

	// The legacy strip rendered `◆ quality│◐ traces│◧ eval│›_ shell`.
	// Any of the three non-`quality` tab labels appearing on the top row
	// indicates the strip is still present.
	for _, marker := range []string{"◐ traces", "◧ eval", "›_ shell"} {
		if strings.Contains(out, marker) {
			t.Errorf("Workbench.View() still contains tab-strip marker %q", marker)
		}
	}
}

func TestOverlayCentersHorizontallyAndOneThirdVertically(t *testing.T) {
	const width, height = 160, 45
	overlay := strings.Join([]string{
		"╭" + strings.Repeat("─", 38) + "╮",
		"│" + strings.Repeat(" ", 38) + "│",
		"╰" + strings.Repeat("─", 38) + "╯",
	}, "\n")
	frame := ansi.Strip(overlayOnto(kit.PadBlock("", width, height), overlay, width, height))
	lines := strings.Split(frame, "\n")
	canvas := workbenchOverlayCanvas(width, height)
	wantTop := (height - 3) / 3
	wantLeft := canvas.X + (canvas.W-40)/2
	gotTop, gotLeft := -1, -1
	for index, line := range lines {
		if left := strings.Index(line, "╭"); left >= 0 {
			gotTop, gotLeft = index, left
			break
		}
	}
	if gotTop != wantTop || gotLeft != wantLeft {
		t.Fatalf("overlay origin = (%d,%d), want (%d,%d)", gotLeft, gotTop, wantLeft, wantTop)
	}
}

func TestOverlayOntoIsAnExactStyledRectangleSplice(t *testing.T) {
	rng := rand.New(rand.NewSource(0x5eed))
	for width := 60; width <= 200; width++ {
		testCase := width - 60
		height := 8 + rng.Intn(20)
		canvas := workbenchOverlayCanvas(width, height)
		overlayWidth := 8 + rng.Intn(min(72, canvas.W)-7)
		overlayHeight := 1 + rng.Intn(min(8, height))
		left := canvas.X + (canvas.W-overlayWidth)/2
		top := (height - overlayHeight) / 3

		baseLines := make([]string, height)
		for row := range baseLines {
			lineWidth := width
			switch row % 4 {
			case 1:
				lineWidth = width - 1 - rng.Intn(min(12, width-1))
			case 2:
				lineWidth = width/2 + rng.Intn(max(1, width-width/2))
			}
			baseLines[row] = randomStyledLine(rng, lineWidth, left, left+overlayWidth)
		}
		overlayLines := make([]string, overlayHeight)
		for row := range overlayLines {
			overlayLines[row] = randomStyledLine(rng, overlayWidth)
		}

		base := kit.PadBlock(strings.Join(baseLines, "\n"), width, height)
		overlay := strings.Join(overlayLines, "\n")
		got := overlayOnto(base, overlay, width, height)
		gotGrid := styledCellGrid(got)
		baseGrid := styledCellGrid(base)
		overlayGrid := styledCellGrid(kit.PadBlock(overlay, overlayWidth, overlayHeight))

		if len(gotGrid) != height {
			t.Fatalf("case %d: rendered %d rows, want %d", testCase, len(gotGrid), height)
		}
		for y, row := range gotGrid {
			if len(row) != width {
				t.Fatalf("case %d row %d: rendered %d cells, want %d", testCase, y, len(row), width)
			}
			for x, gotCell := range row {
				wantCell := baseGrid[y][x]
				region := "base"
				if y >= top && y < top+overlayHeight && x >= left && x < left+overlayWidth {
					wantCell = overlayGrid[y-top][x-left]
					region = "overlay"
				}
				if gotCell.glyph != wantCell.glyph || gotCell.style != wantCell.style {
					t.Fatalf("case %d cell (%d,%d) outside=%t: got glyph %q style %#v, want %s glyph %q style %#v",
						testCase, x, y, region == "base", gotCell.glyph, gotCell.style, region, wantCell.glyph, wantCell.style)
				}
			}
		}
	}
}

func TestOverlayOntoClipsOversizedWideContentAtCellBoundaries(t *testing.T) {
	const width, height = 10, 3
	overlay := "\x1b[31m123456789界🙂tail"
	got := strings.Split(overlayOnto("", overlay, width, height), "\n")
	if len(got) != height {
		t.Fatalf("oversized overlay rendered %d rows, want %d", len(got), height)
	}
	if gotWidth := lipgloss.Width(got[0]); gotWidth != width {
		t.Fatalf("oversized overlay rendered %d cells, want %d: %q", gotWidth, width, got[0])
	}
	if plain, want := ansi.Strip(got[0]), "123456789 "; plain != want {
		t.Fatalf("oversized overlay split a wide glyph:\n got %q\nwant %q", plain, want)
	}
	if !strings.HasPrefix(got[0], ansi.ResetStyle) || !strings.HasSuffix(got[0], ansi.ResetStyle) {
		t.Fatalf("oversized overlay is not SGR-isolated: %q", got[0])
	}
}

func TestOverlayOntoIsolatesModalStyleAndRestoresTheBaseAtBothSeams(t *testing.T) {
	const width, height = 60, 9
	overlay := "\x1b[41m modal without authored reset "
	baseLines := make([]string, height)
	for row := range baseLines {
		baseLines[row] = kit.Fit("\x1b[37;44munderlying界🙂"+strings.Repeat("base", width), width, "")
	}
	base := strings.Join(baseLines, "\n")
	got := overlayOnto(base, overlay, width, height)
	top := (height - 1) / 3
	left := (width - lipgloss.Width(overlay)) / 2
	right := left + lipgloss.Width(overlay)
	gotRow := styledCellGrid(got)[top]
	baseRow := styledCellGrid(base)[top]
	for x := range gotRow {
		want := baseRow[x]
		if x >= left && x < right {
			if gotRow[x].style.Background != "ansi:1" {
				t.Fatalf("modal cell %d background = %q, want ansi:1", x, gotRow[x].style.Background)
			}
			continue
		}
		if gotRow[x].glyph != want.glyph || gotRow[x].style != want.style {
			t.Fatalf("base cell %d after seam = (%q, %#v), want (%q, %#v)", x, gotRow[x].glyph, gotRow[x].style, want.glyph, want.style)
		}
	}
	if resets := strings.Count(strings.Split(got, "\n")[top], ansi.ResetStyle); resets < 2 {
		t.Fatalf("overlay row has %d SGR resets, want isolation at both seams", resets)
	}
}

func TestWorkbenchPalettePreservesEveryCellOutsideItsRectangle(t *testing.T) {
	const width, height = 160, 45
	workbench := fixtureWorkbenchAtScreen(t, "overview")
	workbench.Resize(width, height)
	base := workbench.View()
	workbench.palette.Open()
	canvas := workbenchOverlayCanvas(width, height)
	overlay := workbench.palette.View(canvas.W, canvas.H)
	withPalette := workbench.View()

	overlayLines := strings.Split(overlay, "\n")
	overlayWidth := lipgloss.Width(overlay)
	left := canvas.X + (canvas.W-overlayWidth)/2
	top := (height - len(overlayLines)) / 3
	assertFrameOutsideRectEqual(t, base, withPalette, kit.Rect{X: left, Y: top, W: overlayWidth, H: len(overlayLines)}, "palette")
}

func TestWorkbenchOverlaysStayToTheRightOfTheNavRailAtMediumWidth(t *testing.T) {
	const width, height = 100, 30
	workbench := fixtureWorkbenchAtScreen(t, "overview")
	workbench.Resize(width, height)
	canvas := workbenchOverlayCanvas(width, height)
	overlays := map[string]string{}
	workbench.palette.Open()
	overlays["palette"] = workbench.palette.View(canvas.W, canvas.H)
	workbench.palette.Close()
	workbench.help.Open()
	overlays["help"] = workbench.help.View(canvas.W, canvas.H)
	workbench.help.Close()
	workbench.inspect.Open("span retrieve", "8af2f1c", []byte(`{"query":"typed prompts","hits":4}`))
	overlays["inspect"] = workbench.inspect.View(canvas.W, canvas.H)
	workbench.inspect.Close()
	workbench.definitionChooser.Open([]screens.DefinitionChoice{{ID: "prompt:answer"}, {ID: "agent:support"}})
	overlays["definition-chooser"] = workbench.definitionChooser.View()

	for name, overlay := range overlays {
		left := canvas.X + (canvas.W-lipgloss.Width(overlay))/2
		if left <= shell.NavRailWidth {
			t.Fatalf("%s starts at column %d, want right of nav rail ending at %d", name, left, shell.NavRailWidth)
		}
	}
}

func assertFrameOutsideRectEqual(t *testing.T, base, got string, rect kit.Rect, overlayName string) {
	t.Helper()
	baseGrid := styledCellGrid(base)
	gotGrid := styledCellGrid(got)
	for y := range gotGrid {
		for x := range gotGrid[y] {
			inside := y >= rect.Y && y < rect.Y+rect.H && x >= rect.X && x < rect.X+rect.W
			if inside {
				continue
			}
			got, want := gotGrid[y][x], baseGrid[y][x]
			if got.glyph != want.glyph || got.style != want.style {
				region := "base"
				if x < shell.NavRailWidth {
					region = "nav rail"
				}
				t.Fatalf("%s cell (%d,%d) changed outside %s: got glyph %q style %#v, want glyph %q style %#v",
					region, x, y, overlayName, got.glyph, got.style, want.glyph, want.style)
			}
		}
	}
}

func randomStyledLine(rng *rand.Rand, width int, protectedBoundaries ...int) string {
	styles := []string{
		"",
		"\x1b[m",
		"\x1b[38;2;95;227;200;48;2;16;22;20m",
		"\x1b[38;5;213;48;5;234m",
		"\x1b[31;44m",
	}
	var line strings.Builder
	line.WriteString(styles[rng.Intn(len(styles))])
	for x := 0; x < width; {
		if x > 0 && rng.Intn(7) == 0 {
			line.WriteString(styles[rng.Intn(len(styles))])
		}
		wide := x+2 <= width && rng.Intn(5) == 0
		for _, boundary := range protectedBoundaries {
			// A terminal cannot display half of a double-width grapheme, so
			// rectangle seams are always generated on grapheme boundaries.
			if x+1 == boundary {
				wide = false
			}
		}
		if wide {
			line.WriteString([]string{"界", "🙂", "命"}[rng.Intn(3)])
			x += 2
			continue
		}
		line.WriteByte(byte('a' + rng.Intn(26)))
		x++
	}
	return line.String()
}
