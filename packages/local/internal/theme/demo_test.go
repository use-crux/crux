package theme

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestThemeDemoGoldens(t *testing.T) {
	uitest.Golden(t, "theme-demo-truecolor", renderDemo(colorprofile.TrueColor))
	uitest.Golden(t, "theme-demo-ansi256", renderDemo(colorprofile.ANSI256))
}

func renderDemo(profile colorprofile.Profile) string {
	pal := Resolve(profile)
	styles := NewStyles(pal)

	var b strings.Builder
	b.WriteString(styles.AccentHeader.Render("CRUX PALETTE") + "\n")
	rows := []struct {
		name  string
		style lipgloss.Style
	}{
		{"Bg", lipgloss.NewStyle().Foreground(pal.Bg)},
		{"Bg2", lipgloss.NewStyle().Foreground(pal.Bg2)},
		{"Fg", styles.Regular},
		{"Dim", styles.Dim},
		{"Mut", styles.Muted},
		{"Teal", styles.Accent},
		{"Green", styles.Green},
		{"Amber", styles.Amber},
		{"Red", styles.Red},
		{"Violet", styles.Violet},
		{"Blue", styles.Blue},
		{"Border", styles.Border},
		{"SelBg", lipgloss.NewStyle().Foreground(pal.SelBg)},
	}
	for _, row := range rows {
		b.WriteString(row.style.Render("●") + " " + row.name + "\n")
	}

	b.WriteString("\n")
	b.WriteString(styles.Bold.Render("Bold") + " " + styles.Regular.Render("Regular") + " " + styles.Dim.Render("Dim") + " " + styles.AccentHeader.Render("Accent") + "\n")
	for _, status := range []string{"passed", "failed", "warn", "running", "skipped", "new"} {
		glyph, tone := StatusGlyph(status)
		b.WriteString(styles.ToneStyle(tone).Render(glyph) + " " + status + "\n")
	}
	return b.String()
}
