package kit

// SplitH divides r into side-by-side rectangles with one-cell gutters between
// adjacent panes.
func SplitH(r Rect, cs ...Constraint) []Rect {
	widths := resolveExtent(nonNegative(r.W), len(cs)-1, cs)
	out := make([]Rect, len(cs))
	x := r.X
	for i, w := range widths {
		out[i] = Rect{X: x, Y: r.Y, W: w, H: nonNegative(r.H)}
		x += w
		if i < len(widths)-1 {
			x++
		}
	}
	return out
}

// SplitV divides r into stacked rectangles without gutters.
func SplitV(r Rect, cs ...Constraint) []Rect {
	heights := resolveExtent(nonNegative(r.H), 0, cs)
	out := make([]Rect, len(cs))
	y := r.Y
	for i, h := range heights {
		out[i] = Rect{X: r.X, Y: y, W: nonNegative(r.W), H: h}
		y += h
	}
	return out
}

func resolveExtent(parent int, gutters int, cs []Constraint) []int {
	if len(cs) == 0 {
		return nil
	}
	if gutters < 0 {
		gutters = 0
	}
	total := parent - gutters
	if total < 0 {
		total = 0
	}

	sizes := make([]int, len(cs))
	fixedSum := 0
	for i, c := range cs {
		if c.kind == constraintFixed {
			sizes[i] = c.n
			fixedSum += c.n
		}
	}

	ratioBase := total - fixedSum
	if ratioBase < 0 {
		ratioBase = 0
	}
	for i, c := range cs {
		switch c.kind {
		case constraintRatio:
			sizes[i] = (ratioBase * c.num) / c.den
		case constraintMin:
			sizes[i] = c.n
		}
	}

	allocated := sum(sizes)
	leftover := total - allocated
	if leftover > 0 {
		distributeLeftover(sizes, cs, leftover)
	} else if leftover < 0 {
		shrinkOverflow(sizes, cs, -leftover)
	}
	return sizes
}

func distributeLeftover(sizes []int, cs []Constraint, leftover int) {
	fillIndexes := indexesOfKind(cs, constraintFill)
	if len(fillIndexes) > 0 {
		each := leftover / len(fillIndexes)
		rem := leftover % len(fillIndexes)
		for i, idx := range fillIndexes {
			sizes[idx] += each
			if i == 0 {
				sizes[idx] += rem
			}
		}
		return
	}
	if idx := lastIndexOfKind(cs, constraintMin); idx >= 0 {
		sizes[idx] += leftover
		return
	}
	if idx := lastIndexOfKind(cs, constraintRatio); idx >= 0 {
		sizes[idx] += leftover
		return
	}
	if idx := lastIndexOfKind(cs, constraintFixed); idx >= 0 {
		sizes[idx] += leftover
	}
}

func shrinkOverflow(sizes []int, cs []Constraint, overflow int) {
	for _, kind := range []constraintKind{constraintFill, constraintRatio, constraintMin, constraintFixed} {
		for i := len(cs) - 1; i >= 0 && overflow > 0; i-- {
			if cs[i].kind != kind || sizes[i] == 0 {
				continue
			}
			delta := sizes[i]
			if delta > overflow {
				delta = overflow
			}
			sizes[i] -= delta
			overflow -= delta
		}
	}
}

func indexesOfKind(cs []Constraint, kind constraintKind) []int {
	var out []int
	for i, c := range cs {
		if c.kind == kind {
			out = append(out, i)
		}
	}
	return out
}

func lastIndexOfKind(cs []Constraint, kind constraintKind) int {
	for i := len(cs) - 1; i >= 0; i-- {
		if cs[i].kind == kind {
			return i
		}
	}
	return -1
}

func sum(vals []int) int {
	total := 0
	for _, v := range vals {
		total += v
	}
	return total
}
