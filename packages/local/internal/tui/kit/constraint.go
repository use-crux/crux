package kit

type constraintKind int

const (
	constraintFixed constraintKind = iota
	constraintMin
	constraintRatio
	constraintFill
)

// Constraint describes one pane's desired size along a split axis.
type Constraint struct {
	kind constraintKind
	n    int
	num  int
	den  int
}

// Fixed returns a constraint for exactly n cells before overflow shrinkage.
func Fixed(n int) Constraint {
	return Constraint{kind: constraintFixed, n: nonNegative(n)}
}

// Min returns a constraint for at least n cells before overflow shrinkage.
func Min(n int) Constraint {
	return Constraint{kind: constraintMin, n: nonNegative(n)}
}

// Ratio returns a proportional share of the post-fixed available cells.
func Ratio(num, den int) Constraint {
	if num < 0 {
		num = 0
	}
	if den <= 0 {
		den = 1
	}
	return Constraint{kind: constraintRatio, num: num, den: den}
}

// Fill returns a greedy remainder constraint.
func Fill() Constraint {
	return Constraint{kind: constraintFill}
}

func nonNegative(n int) int {
	if n < 0 {
		return 0
	}
	return n
}
