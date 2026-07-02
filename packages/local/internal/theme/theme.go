// Package theme owns Crux terminal colors, glyphs, and text hierarchy.
package theme

import (
	"image/color"

	"github.com/charmbracelet/colorprofile"
)

// Palette is the resolved color set for one terminal color profile.
type Palette struct {
	Bg     color.Color
	Bg2    color.Color
	Fg     color.Color
	Dim    color.Color
	Mut    color.Color
	Teal   color.Color
	Green  color.Color
	Amber  color.Color
	Red    color.Color
	Violet color.Color
	Blue   color.Color
	Border color.Color
	SelBg  color.Color
}

// Resolve maps the canonical design tokens to concrete colors for profile.
func Resolve(profile colorprofile.Profile) Palette {
	return Palette{
		Bg:     resolveToken(profile, tokens.Bg),
		Bg2:    resolveToken(profile, tokens.Bg2),
		Fg:     resolveToken(profile, tokens.Fg),
		Dim:    resolveToken(profile, tokens.Dim),
		Mut:    resolveToken(profile, tokens.Mut),
		Teal:   resolveToken(profile, tokens.Teal),
		Green:  resolveToken(profile, tokens.Green),
		Amber:  resolveToken(profile, tokens.Amber),
		Red:    resolveToken(profile, tokens.Red),
		Violet: resolveToken(profile, tokens.Violet),
		Blue:   resolveToken(profile, tokens.Blue),
		Border: resolveToken(profile, tokens.Border),
		SelBg:  resolveToken(profile, tokens.SelBg),
	}
}
