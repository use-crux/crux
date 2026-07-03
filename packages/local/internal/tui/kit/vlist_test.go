package kit

import (
	"fmt"
	"math/rand"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestVListMovementKeepsCursorVisible(t *testing.T) {
	t.Parallel()

	var list VList[string]
	list.SetItems([]string{"a", "b", "c", "d", "e"})
	list.SetHeight(3)

	list.CursorDown()
	list.CursorDown()
	list.CursorDown()

	if _, idx, _ := list.Cursor(); idx != 3 {
		t.Fatalf("cursor index = %d, want 3", idx)
	}
	if got := list.Offset(); got != 1 {
		t.Fatalf("offset = %d, want 1", got)
	}
}

func TestVListPreservesCursorByIdentity(t *testing.T) {
	t.Parallel()

	type item struct{ id string }
	var list VList[item]
	list.SetIdentity(func(i item) string { return i.id })
	list.SetItems([]item{{"a"}, {"b"}, {"c"}})
	list.SetHeight(2)
	list.CursorDown()

	list.SetItems([]item{{"x"}, {"b"}, {"c"}, {"d"}})

	got, idx, ok := list.Cursor()
	if !ok || got.id != "b" || idx != 1 {
		t.Fatalf("cursor = (%+v, %d, %v), want b at 1", got, idx, ok)
	}
}

func TestVListRenderBounds(t *testing.T) {
	t.Parallel()

	var list VList[string]
	list.SetItems([]string{"alpha", "beta", "gamma", "delta"})
	list.SetHeight(2)

	lines := list.Render(6, func(item string, i int, selected bool, w int) string {
		return item
	})

	if len(lines) != 2 {
		t.Fatalf("len(lines) = %d, want 2", len(lines))
	}
	for i, line := range lines {
		if got := lipgloss.Width(line); got != 6 {
			t.Fatalf("line %d width = %d, want 6: %q", i, got, line)
		}
	}
}

func TestVListProperties(t *testing.T) {
	t.Parallel()

	rng := rand.New(rand.NewSource(11))
	for caseN := 0; caseN < 1_000; caseN++ {
		var list VList[string]
		list.SetIdentity(func(s string) string { return s })
		for step := 0; step < 80; step++ {
			switch rng.Intn(7) {
			case 0:
				list.SetHeight(rng.Intn(12))
			case 1:
				list.SetItems(numberedItems(rng.Intn(40)))
			case 2:
				list.CursorDown()
			case 3:
				list.CursorUp()
			case 4:
				list.PageDown()
			case 5:
				list.PageUp()
			default:
				list.End()
			}
			assertVListInvariants(t, &list)
		}
	}
}

func numberedItems(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("item-%02d", i)
	}
	return out
}

func assertVListInvariants[T any](t *testing.T, list *VList[T]) {
	t.Helper()
	if list.offset < 0 {
		t.Fatalf("offset below zero: %+v", list)
	}
	maxOffset := len(list.items) - list.visibleCapacity()
	if maxOffset < 0 {
		maxOffset = 0
	}
	if list.offset > maxOffset {
		t.Fatalf("offset = %d, max = %d: %+v", list.offset, maxOffset, list)
	}
	if len(list.items) == 0 {
		return
	}
	if list.cursor < 0 || list.cursor >= len(list.items) {
		t.Fatalf("cursor out of range: %+v", list)
	}
	if list.height > 0 {
		visibleEnd := list.offset + list.visibleCapacity()
		if list.cursor < list.offset || list.cursor >= visibleEnd {
			t.Fatalf("cursor not visible: %+v visibleEnd=%d", list, visibleEnd)
		}
	}
}
