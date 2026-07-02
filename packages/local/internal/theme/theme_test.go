package theme

import (
	"testing"

	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
)

func TestResolvePinsANSI256Palette(t *testing.T) {
	pal := Resolve(colorprofile.ANSI256)

	cases := map[string]struct {
		got  ansi.IndexedColor
		want ansi.IndexedColor
	}{
		"Bg":     {pal.Bg.(ansi.IndexedColor), 233},
		"Bg2":    {pal.Bg2.(ansi.IndexedColor), 234},
		"Fg":     {pal.Fg.(ansi.IndexedColor), 252},
		"Dim":    {pal.Dim.(ansi.IndexedColor), 244},
		"Mut":    {pal.Mut.(ansi.IndexedColor), 240},
		"Teal":   {pal.Teal.(ansi.IndexedColor), 86},
		"Green":  {pal.Green.(ansi.IndexedColor), 114},
		"Amber":  {pal.Amber.(ansi.IndexedColor), 179},
		"Red":    {pal.Red.(ansi.IndexedColor), 203},
		"Violet": {pal.Violet.(ansi.IndexedColor), 139},
		"Blue":   {pal.Blue.(ansi.IndexedColor), 75},
		"Border": {pal.Border.(ansi.IndexedColor), 238},
		"SelBg":  {pal.SelBg.(ansi.IndexedColor), 236},
	}

	for name, tc := range cases {
		if tc.got != tc.want {
			t.Fatalf("%s = %v, want %v", name, tc.got, tc.want)
		}
	}
}

func TestSemanticToneTables(t *testing.T) {
	glyph, tone := StatusGlyph("failed")
	if glyph != "●" || tone != ToneRed {
		t.Fatalf("StatusGlyph(failed) = %q/%s, want ●/%s", glyph, tone, ToneRed)
	}
	glyph, tone = StatusGlyph("running")
	if glyph != "◆" || tone != ToneTeal {
		t.Fatalf("StatusGlyph(running) = %q/%s, want ◆/%s", glyph, tone, ToneTeal)
	}
	if got := SeverityTone("medium"); got != ToneAmber {
		t.Fatalf("SeverityTone(medium) = %s, want %s", got, ToneAmber)
	}
	if got := SeverityTone("unknown"); got != ToneDim {
		t.Fatalf("SeverityTone(unknown) = %s, want %s", got, ToneDim)
	}
}
