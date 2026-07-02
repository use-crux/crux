// Package kit contains pure, rect-bounded terminal layout and render helpers
// shared by the Crux TUI screens.
package kit

// Rect is a terminal-cell rectangle.
//
// X and Y are canvas coordinates. W and H are cell dimensions and are always
// clamped to non-negative values by the kit splitters.
type Rect struct {
	X int
	Y int
	W int
	H int
}

// LayoutClass is the shell/screen breakpoint selected from terminal width.
type LayoutClass int

const (
	// LayoutSingle is used below 80 columns.
	LayoutSingle LayoutClass = iota
	// LayoutTwo is used from 80 through 119 columns.
	LayoutTwo
	// LayoutFull is used from 120 columns upward.
	LayoutFull
)

// Classify returns the responsive layout class for width.
func Classify(width int) LayoutClass {
	switch {
	case width >= 120:
		return LayoutFull
	case width >= 80:
		return LayoutTwo
	default:
		return LayoutSingle
	}
}
