package kit

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestSplitHSumsToParentWithGutters(t *testing.T) {
	t.Parallel()

	parent := Rect{X: 3, Y: 2, W: 80, H: 12}
	rects := SplitH(parent, Fixed(18), Ratio(1, 2), Fill())

	if len(rects) != 3 {
		t.Fatalf("len(rects) = %d, want 3", len(rects))
	}
	used := 0
	for _, r := range rects {
		if r.W < 0 || r.H < 0 {
			t.Fatalf("negative rect: %+v", r)
		}
		used += r.W
	}
	used += 2 // SplitH gutter between adjacent panes.
	if used != parent.W {
		t.Fatalf("used width = %d, want %d: %+v", used, parent.W, rects)
	}
	if rects[0].X != parent.X || rects[1].X != rects[0].X+rects[0].W+1 {
		t.Fatalf("unexpected x positions: %+v", rects)
	}
}

func TestSplitHShrinksRightToLeftByClass(t *testing.T) {
	t.Parallel()

	parent := Rect{W: 10, H: 4}
	rects := SplitH(parent, Fixed(8), Min(8), Ratio(1, 1), Fill())

	used := 3
	for _, r := range rects {
		if r.W < 0 {
			t.Fatalf("negative rect: %+v", rects)
		}
		used += r.W
	}
	if used != parent.W {
		t.Fatalf("used width = %d, want %d: %+v", used, parent.W, rects)
	}
	if rects[3].W != 0 || rects[2].W != 0 {
		t.Fatalf("rightmost fill and ratio should shrink first: %+v", rects)
	}
}

func TestSplitVHasNoGutter(t *testing.T) {
	t.Parallel()

	parent := Rect{X: 1, Y: 5, W: 20, H: 11}
	rects := SplitV(parent, Fixed(3), Fill(), Fixed(2))

	used := 0
	for _, r := range rects {
		used += r.H
		if r.X != parent.X || r.W != parent.W {
			t.Fatalf("SplitV changed x/width: %+v", r)
		}
	}
	if used != parent.H {
		t.Fatalf("used height = %d, want %d: %+v", used, parent.H, rects)
	}
	if rects[1].Y != rects[0].Y+rects[0].H {
		t.Fatalf("unexpected y positions: %+v", rects)
	}
}

func TestClassify(t *testing.T) {
	t.Parallel()

	tests := []struct {
		width int
		want  LayoutClass
	}{
		{60, LayoutSingle},
		{79, LayoutSingle},
		{80, LayoutTwo},
		{119, LayoutTwo},
		{120, LayoutFull},
	}
	for _, tt := range tests {
		if got := Classify(tt.width); got != tt.want {
			t.Fatalf("Classify(%d) = %v, want %v", tt.width, got, tt.want)
		}
	}
}

func TestTruncateWidth(t *testing.T) {
	t.Parallel()

	got := Truncate("abcdef", 4, "…")
	if got != "abc…" {
		t.Fatalf("Truncate = %q, want %q", got, "abc…")
	}
	if w := lipgloss.Width(got); w != 4 {
		t.Fatalf("width = %d, want 4", w)
	}
	if got := Truncate("◆abcdef", 4, "…"); lipgloss.Width(got) > 4 {
		t.Fatalf("wide truncate overflowed: %q", got)
	}
}

func TestComposeBoundsAndDividers(t *testing.T) {
	t.Parallel()

	rects := SplitH(Rect{W: 12, H: 3}, Fixed(5), Fill())
	lines := Compose(rects, [][]string{
		{"left wide", "a"},
		{"right", "b", "c"},
	})

	if len(lines) != 3 {
		t.Fatalf("len(lines) = %d, want 3: %q", len(lines), strings.Join(lines, "\n"))
	}
	for i, line := range lines {
		if got := lipgloss.Width(line); got != 12 {
			t.Fatalf("line %d width = %d, want 12: %q", i, got, line)
		}
	}
	if !strings.Contains(lines[0], "│") {
		t.Fatalf("first line missing divider: %q", lines[0])
	}
}
