package theme

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// Styles is the immutable text-hierarchy style set for a resolved palette.
type Styles struct {
	Bold           lipgloss.Style
	Regular        lipgloss.Style
	Dim            lipgloss.Style
	Muted          lipgloss.Style
	Accent         lipgloss.Style
	AccentHeader   lipgloss.Style
	Reverse        lipgloss.Style
	Selected       lipgloss.Style
	Green          lipgloss.Style
	Amber          lipgloss.Style
	Red            lipgloss.Style
	Violet         lipgloss.Style
	Blue           lipgloss.Style
	Border         lipgloss.Style
	SurfaceRail    lipgloss.Style
	SurfaceBody    lipgloss.Style
	SurfaceBand    lipgloss.Style
	SurfaceOverlay lipgloss.Style
}

// NewStyles builds reusable styles from pal. Call once and reuse the result.
func NewStyles(pal Palette) Styles {
	return Styles{
		Bold:           lipgloss.NewStyle().Foreground(pal.Fg).Bold(true),
		Regular:        lipgloss.NewStyle().Foreground(pal.Fg),
		Dim:            lipgloss.NewStyle().Foreground(pal.Dim),
		Muted:          lipgloss.NewStyle().Foreground(pal.Mut),
		Accent:         lipgloss.NewStyle().Foreground(pal.Teal),
		AccentHeader:   lipgloss.NewStyle().Foreground(pal.Teal).Bold(true),
		Reverse:        lipgloss.NewStyle().Foreground(pal.Bg).Background(pal.Teal),
		Selected:       lipgloss.NewStyle().Foreground(pal.Fg).Background(pal.SelBg),
		Green:          lipgloss.NewStyle().Foreground(pal.Green),
		Amber:          lipgloss.NewStyle().Foreground(pal.Amber),
		Red:            lipgloss.NewStyle().Foreground(pal.Red),
		Violet:         lipgloss.NewStyle().Foreground(pal.Violet),
		Blue:           lipgloss.NewStyle().Foreground(pal.Blue),
		Border:         lipgloss.NewStyle().Foreground(pal.Border),
		SurfaceRail:    lipgloss.NewStyle().Background(pal.Bg2),
		SurfaceBody:    lipgloss.NewStyle().Background(pal.Bg),
		SurfaceBand:    lipgloss.NewStyle().Background(pal.Bg2),
		SurfaceOverlay: lipgloss.NewStyle().Background(pal.Bg),
	}
}

// SurfaceLine paints every cell in line with one declared surface. It
// reapplies the surface after nested text-style resets, so foreground styling
// cannot punch holes in a rail, band, or overlay background.
func SurfaceLine(surface lipgloss.Style, line string, width int) string {
	if width <= 0 {
		return ""
	}
	if got := lipgloss.Width(line); got < width {
		line += strings.Repeat(" ", width-got)
	}
	prefix := surfacePrefix(surface)
	if prefix == "" {
		return line
	}
	line = strings.ReplaceAll(line, ansi.ResetStyle, ansi.ResetStyle+prefix)
	line = strings.ReplaceAll(line, "\x1b[0m", "\x1b[0m"+prefix)
	return prefix + line + ansi.ResetStyle
}

func surfacePrefix(surface lipgloss.Style) string {
	rendered := surface.Render(" ")
	index := strings.IndexByte(rendered, ' ')
	if index <= 0 {
		return ""
	}
	return rendered[:index]
}

// ToneStyle returns the style for a semantic tone.
func (s Styles) ToneStyle(tone Tone) lipgloss.Style {
	switch tone {
	case ToneTeal:
		return s.Accent
	case ToneGreen:
		return s.Green
	case ToneAmber:
		return s.Amber
	case ToneRed:
		return s.Red
	case ToneViolet:
		return s.Violet
	case ToneBlue:
		return s.Blue
	case ToneDim:
		return s.Dim
	default:
		return s.Regular
	}
}

// Badge renders a bracketed label using the semantic tone color.
func (s Styles) Badge(tone Tone, label string) string {
	style := s.ToneStyle(tone)
	return style.Render("[") + s.Regular.Render(label) + style.Render("]")
}
