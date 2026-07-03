package theme

import (
	"image/color"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
)

type token struct {
	truecolor string
	a256      uint8
	a16       ansi.BasicColor
}

var tokens = struct {
	Bg, Bg2, Fg, Dim, Mut, Teal, Green, Amber, Red, Violet, Blue, Border, SelBg token
}{
	Bg:     token{"#0b0f0e", 233, ansi.Black},
	Bg2:    token{"#101614", 234, ansi.Black},
	Fg:     token{"#ccd6cf", 252, ansi.White},
	Dim:    token{"#6d7872", 244, ansi.BrightBlack},
	Mut:    token{"#454e49", 240, ansi.BrightBlack},
	Teal:   token{"#5fe3c8", 86, ansi.Cyan},
	Green:  token{"#7ee787", 114, ansi.Green},
	Amber:  token{"#e3b341", 179, ansi.Yellow},
	Red:    token{"#f4787b", 203, ansi.Red},
	Violet: token{"#b48ead", 139, ansi.Magenta},
	Blue:   token{"#6cb6ff", 75, ansi.Blue},
	Border: token{"#2a352f", 238, ansi.BrightBlack},
	SelBg:  token{"#16302a", 236, ansi.BrightBlack},
}

func resolveToken(profile colorprofile.Profile, tok token) color.Color {
	switch profile {
	case colorprofile.TrueColor:
		return lipgloss.Color(tok.truecolor)
	case colorprofile.ANSI256:
		return ansi.IndexedColor(tok.a256)
	case colorprofile.ANSI:
		return tok.a16
	default:
		return ansi.BasicColor(ansi.White)
	}
}
