package components

import (
	"math"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Box-character fallback (kept for the rare row sparkline that only has
// 1-cell vertical room — e.g. nav-rail tail badges).
var sparkChars = []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}

// Sparkline renders `values` as a single-row braille sparkline. Two samples
// fit per glyph column horizontally with 4 levels per dot column, so the
// curve is much smoother than the 8-bar block fallback. When `width` is set
// it caps the number of glyph columns from the right (so the rendered
// string is at most `width` characters wide; effective sample count is
// `width * 2`).
func Sparkline(values []float64, width int, color lipgloss.Color) string {
	if len(values) == 0 {
		return ""
	}
	if width > 0 && len(values) > width*2 {
		values = values[len(values)-width*2:]
	}
	maxV, minV := values[0], values[0]
	for _, v := range values {
		if v > maxV {
			maxV = v
		}
		if v < minV {
			minV = v
		}
	}
	rng := maxV - minV
	if rng <= 0 {
		rng = 1
	}
	// 4 rows per braille glyph; we map each sample to one of [0,3].
	rowFor := func(v float64) int {
		idx := int(math.Round(((v - minV) / rng) * 3))
		if idx < 0 {
			idx = 0
		}
		if idx > 3 {
			idx = 3
		}
		// Braille rows are inverted: 0 = top, 3 = bottom in our coordinate.
		return 3 - idx
	}
	var b strings.Builder
	for i := 0; i < len(values); i += 2 {
		left := rowFor(values[i])
		right := left
		if i+1 < len(values) {
			right = rowFor(values[i+1])
		}
		b.WriteRune(brailleGlyph(left, right))
	}
	return lipgloss.NewStyle().Foreground(color).Render(b.String())
}

// SparklineFilled renders an area-fill sparkline using braille glyphs: every
// dot at-or-below the data row is set, producing the filled-curve look the
// V1 design uses for KPI cards.
func SparklineFilled(values []float64, width int, color lipgloss.Color) string {
	if len(values) == 0 {
		return ""
	}
	if width > 0 && len(values) > width*2 {
		values = values[len(values)-width*2:]
	}
	maxV, minV := values[0], values[0]
	for _, v := range values {
		if v > maxV {
			maxV = v
		}
		if v < minV {
			minV = v
		}
	}
	rng := maxV - minV
	if rng <= 0 {
		rng = 1
	}
	rowFor := func(v float64) int {
		idx := int(math.Round(((v - minV) / rng) * 3))
		if idx < 0 {
			idx = 0
		}
		if idx > 3 {
			idx = 3
		}
		return 3 - idx // top = 0
	}
	var b strings.Builder
	for i := 0; i < len(values); i += 2 {
		left := rowFor(values[i])
		right := left
		if i+1 < len(values) {
			right = rowFor(values[i+1])
		}
		b.WriteRune(brailleGlyphFilled(left, right))
	}
	return lipgloss.NewStyle().Foreground(color).Render(b.String())
}

// brailleGlyph returns the braille char (U+2800..U+28FF) with two dots set:
// one in the left column at row `l`, one in the right column at row `r`.
// Rows are numbered 0 (top) through 3 (bottom). The 8-dot braille pattern
// numbering is fixed: bit values are 0x01..0x80 in a specific order.
//
//	col left  col right
//	row 0  : 0x01     0x08
//	row 1  : 0x02     0x10
//	row 2  : 0x04     0x20
//	row 3  : 0x40     0x80
func brailleGlyph(l, r int) rune {
	return rune(0x2800 | bitForRow(l, false) | bitForRow(r, true))
}

// brailleGlyphFilled sets every dot at-or-below the data row, in both
// columns — producing the filled-area look.
func brailleGlyphFilled(l, r int) rune {
	mask := uint(0x2800)
	for row := l; row <= 3; row++ {
		mask |= bitForRow(row, false)
	}
	for row := r; row <= 3; row++ {
		mask |= bitForRow(row, true)
	}
	return rune(mask)
}

func bitForRow(row int, right bool) uint {
	if right {
		switch row {
		case 0:
			return 0x08
		case 1:
			return 0x10
		case 2:
			return 0x20
		case 3:
			return 0x80
		}
	}
	switch row {
	case 0:
		return 0x01
	case 1:
		return 0x02
	case 2:
		return 0x04
	case 3:
		return 0x40
	}
	return 0
}

// SparklineBlock keeps the old 8-step box-character renderer for places where
// braille is too dense (e.g. inline 1-cell tags).
func SparklineBlock(values []float64, width int, color lipgloss.Color) string {
	if len(values) == 0 {
		return ""
	}
	if width > 0 && len(values) > width {
		values = values[len(values)-width:]
	}
	maxV, minV := values[0], values[0]
	for _, v := range values {
		if v > maxV {
			maxV = v
		}
		if v < minV {
			minV = v
		}
	}
	rng := maxV - minV
	if rng <= 0 {
		rng = 1
	}
	var b strings.Builder
	for _, v := range values {
		idx := int(((v - minV) / rng) * float64(len(sparkChars)-1))
		if idx < 0 {
			idx = 0
		}
		if idx >= len(sparkChars) {
			idx = len(sparkChars) - 1
		}
		b.WriteRune(sparkChars[idx])
	}
	return lipgloss.NewStyle().Foreground(color).Render(b.String())
}

// SparklineInt is a convenience wrapper around Sparkline for int slices.
func SparklineInt(values []int, width int, color lipgloss.Color) string {
	if len(values) == 0 {
		return ""
	}
	f := make([]float64, len(values))
	for i, v := range values {
		f[i] = float64(v)
	}
	return Sparkline(f, width, color)
}
