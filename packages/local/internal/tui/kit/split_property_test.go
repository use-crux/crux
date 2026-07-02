package kit

import (
	"math/rand"
	"testing"
)

func TestSplitProperties(t *testing.T) {
	t.Parallel()

	rng := rand.New(rand.NewSource(7))
	for i := 0; i < 2_000; i++ {
		parent := Rect{W: rng.Intn(301), H: rng.Intn(121)}
		constraints := randomConstraints(rng, 1+rng.Intn(6))

		hRects := SplitH(parent, constraints...)
		assertSplitExtent(t, "SplitH", parent.W, len(hRects)-1, hRects, func(r Rect) int { return r.W })

		vRects := SplitV(parent, constraints...)
		assertSplitExtent(t, "SplitV", parent.H, 0, vRects, func(r Rect) int { return r.H })
	}
}

func randomConstraints(rng *rand.Rand, n int) []Constraint {
	out := make([]Constraint, n)
	for i := range out {
		switch rng.Intn(4) {
		case 0:
			out[i] = Fixed(rng.Intn(80))
		case 1:
			out[i] = Min(rng.Intn(80))
		case 2:
			out[i] = Ratio(rng.Intn(5), 1+rng.Intn(5))
		default:
			out[i] = Fill()
		}
	}
	return out
}

func assertSplitExtent(t *testing.T, name string, parent int, gutters int, rects []Rect, extent func(Rect) int) {
	t.Helper()

	used := gutters
	if used < 0 {
		used = 0
	}
	for _, r := range rects {
		size := extent(r)
		if size < 0 {
			t.Fatalf("%s produced negative extent: %+v", name, rects)
		}
		used += size
	}
	if parent < gutters {
		if used != gutters {
			t.Fatalf("%s used = %d, want gutter floor %d: %+v", name, used, gutters, rects)
		}
		return
	}
	if used != parent {
		t.Fatalf("%s used = %d, want %d: %+v", name, used, parent, rects)
	}
}
