package kit

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

func TestTableRendersHeaderAndRowsWithinWidth(t *testing.T) {
	t.Parallel()

	styles := theme.NewStyles(theme.Resolve(colorprofile.TrueColor))
	table := NewTable[string]([]Col[string]{
		{Title: "Name", C: Fixed(8), Value: func(s string) string { return s }},
		{Title: "State", C: Fill(), Value: func(s string) string { return "ok" }},
	})
	table.SetItems([]string{"alpha", "beta"})
	table.SetHeight(4)

	lines := table.Render(16, styles)
	if len(lines) != 4 {
		t.Fatalf("len(lines) = %d, want 4: %q", len(lines), strings.Join(lines, "\n"))
	}
	for i, line := range lines {
		if got := lipgloss.Width(line); got != 16 {
			t.Fatalf("line %d width = %d, want 16: %q", i, got, line)
		}
	}
	if !strings.Contains(lines[0], "Name") || !strings.Contains(lines[0], "State") {
		t.Fatalf("header missing titles: %q", lines[0])
	}
}
