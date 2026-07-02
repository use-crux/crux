package kit

import "testing"

func TestMemoCachesByKey(t *testing.T) {
	t.Parallel()

	var memo Memo
	key := MemoKey{Revision: 1, Rect: Rect{W: 10, H: 2}, Focus: "list"}
	calls := 0

	first := memo.Get(key, func() []string {
		calls++
		return []string{"one"}
	})
	second := memo.Get(key, func() []string {
		calls++
		return []string{"two"}
	})

	if calls != 1 {
		t.Fatalf("render calls = %d, want 1", calls)
	}
	if first[0] != "one" || second[0] != "one" {
		t.Fatalf("unexpected cached values: %q %q", first, second)
	}
	second[0] = "mutated"
	third := memo.Get(key, func() []string { return []string{"three"} })
	if third[0] != "one" {
		t.Fatalf("cache returned mutable slice: %q", third)
	}
}
