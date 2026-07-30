package tui

import (
	"fmt"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
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
	wantTop := (height - 3) / 3
	wantLeft := (width - 40) / 2
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

func TestOverlayOntoCompositesAnOpaqueRowAtEverySupportedWidth(t *testing.T) {
	const height = 12
	overlayLines := []string{
		"\x1b[38;2;95;227;200m╭──────────────╮\x1b[m",
		"│ \x1b[1;35m命令🙂\x1b[m modal │",
		"\x1b[38;2;95;227;200m╰──────────────╯\x1b[m",
	}
	overlay := strings.Join(overlayLines, "\n")
	overlayWidth := lipgloss.Width(overlay)
	top := (height - len(overlayLines)) / 3

	for width := 60; width <= 200; width++ {
		baseLines := syntheticOverlayBase(width, height)
		got := overlayOnto(strings.Join(baseLines, "\n"), overlay, width, height)
		gotLines := strings.Split(got, "\n")
		if len(gotLines) != height {
			t.Fatalf("width %d rendered %d rows, want %d", width, len(gotLines), height)
		}

		left := (width - overlayWidth) / 2
		for row, line := range gotLines {
			if gotWidth := lipgloss.Width(line); gotWidth != width {
				t.Fatalf("width %d row %d rendered %d cells, want %d: %q", width, row, gotWidth, width, line)
			}
			if row < top || row >= top+len(overlayLines) {
				if line != baseLines[row] {
					t.Fatalf("width %d row %d changed outside the overlay:\n got %q\nwant %q", width, row, line, baseLines[row])
				}
				continue
			}

			gotLeft := ansi.Strip(ansi.Cut(line, 0, left))
			gotModal := ansi.Strip(ansi.Cut(line, left, left+overlayWidth))
			gotRight := ansi.Strip(ansi.Cut(line, left+overlayWidth, width))
			if want := strings.Repeat(" ", left); gotLeft != want {
				t.Fatalf("width %d row %d left seam = %q, want opaque backdrop", width, row, gotLeft)
			}
			if want := ansi.Strip(kit.Fit(overlayLines[row-top], overlayWidth, "")); gotModal != want {
				t.Fatalf("width %d row %d modal = %q, want %q", width, row, gotModal, want)
			}
			if want := strings.Repeat(" ", width-left-overlayWidth); gotRight != want {
				t.Fatalf("width %d row %d right seam = %q, want opaque backdrop", width, row, gotRight)
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

func TestOverlayOntoResetsStyleBeforeTheRightBackdrop(t *testing.T) {
	const width, height = 60, 9
	overlay := "\x1b[41m modal without authored reset "
	baseLines := make([]string, height)
	for row := range baseLines {
		baseLines[row] = "\x1b[44munderlying界🙂"
	}
	got := strings.Split(overlayOnto(strings.Join(baseLines, "\n"), overlay, width, height), "\n")
	top := (height - 1) / 3
	left := (width - lipgloss.Width(overlay)) / 2
	rightWidth := width - (width-lipgloss.Width(overlay))/2 - lipgloss.Width(overlay)
	if !strings.HasPrefix(got[top], ansi.ResetStyle+strings.Repeat(" ", left)) {
		t.Fatalf("overlay row does not reset SGR before its left backdrop: %q", got[top])
	}
	if !strings.HasSuffix(got[top], ansi.ResetStyle+strings.Repeat(" ", rightWidth)) {
		t.Fatalf("overlay row does not reset SGR before its right backdrop: %q", got[top])
	}
}

func syntheticOverlayBase(width, height int) []string {
	lines := make([]string, height)
	for row := range lines {
		text := fmt.Sprintf("row-%02d \x1b[31mANSI-red\x1b[m 界🙂 ", row)
		target := width
		if row%3 == 1 {
			target = width - 7
		} else if row%3 == 2 {
			target = width/2 + row
		}
		lines[row] = kit.Fit(text+strings.Repeat(string(rune('a'+row%26)), width), target, "")
		lines[row] = kit.Fit(lines[row], width, "")
	}
	return lines
}
