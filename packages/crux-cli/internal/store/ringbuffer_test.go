package store

import (
	"testing"
)

func TestRingBuffer_Push(t *testing.T) {
	tests := []struct {
		name      string
		max       int
		pushes    []int
		wantLen   int
		wantItems []int
	}{
		{
			name:      "empty buffer",
			max:       5,
			pushes:    nil,
			wantLen:   0,
			wantItems: []int{},
		},
		{
			name:      "under capacity",
			max:       5,
			pushes:    []int{1, 2, 3},
			wantLen:   3,
			wantItems: []int{1, 2, 3},
		},
		{
			name:      "at capacity",
			max:       3,
			pushes:    []int{1, 2, 3},
			wantLen:   3,
			wantItems: []int{1, 2, 3},
		},
		{
			name:      "over capacity evicts oldest",
			max:       3,
			pushes:    []int{1, 2, 3, 4},
			wantLen:   3,
			wantItems: []int{2, 3, 4},
		},
		{
			name:      "far over capacity",
			max:       2,
			pushes:    []int{1, 2, 3, 4, 5, 6},
			wantLen:   2,
			wantItems: []int{5, 6},
		},
		{
			name:      "capacity of one",
			max:       1,
			pushes:    []int{1, 2, 3},
			wantLen:   1,
			wantItems: []int{3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rb := NewRingBuffer[int](tt.max)
			for _, v := range tt.pushes {
				rb.Push(v)
			}

			if got := rb.Len(); got != tt.wantLen {
				t.Errorf("Len() = %d, want %d", got, tt.wantLen)
			}

			items := rb.Items()
			if len(items) != len(tt.wantItems) {
				t.Fatalf("Items() len = %d, want %d", len(items), len(tt.wantItems))
			}
			for i, want := range tt.wantItems {
				if items[i] != want {
					t.Errorf("Items()[%d] = %d, want %d", i, items[i], want)
				}
			}
		})
	}
}

func TestRingBuffer_Last(t *testing.T) {
	tests := []struct {
		name    string
		pushes  []int
		wantVal int
		wantOk  bool
	}{
		{
			name:    "empty",
			pushes:  nil,
			wantVal: 0,
			wantOk:  false,
		},
		{
			name:    "single item",
			pushes:  []int{42},
			wantVal: 42,
			wantOk:  true,
		},
		{
			name:    "multiple items",
			pushes:  []int{1, 2, 3},
			wantVal: 3,
			wantOk:  true,
		},
		{
			name:    "after eviction",
			pushes:  []int{1, 2, 3, 4, 5}, // max=3
			wantVal: 5,
			wantOk:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rb := NewRingBuffer[int](3)
			for _, v := range tt.pushes {
				rb.Push(v)
			}

			got, ok := rb.Last()
			if ok != tt.wantOk {
				t.Errorf("Last() ok = %v, want %v", ok, tt.wantOk)
			}
			if got != tt.wantVal {
				t.Errorf("Last() = %d, want %d", got, tt.wantVal)
			}
		})
	}
}

func TestRingBuffer_Clear(t *testing.T) {
	rb := NewRingBuffer[string](5)
	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	rb.Clear()

	if rb.Len() != 0 {
		t.Errorf("after Clear(), Len() = %d, want 0", rb.Len())
	}

	items := rb.Items()
	if len(items) != 0 {
		t.Errorf("after Clear(), Items() len = %d, want 0", len(items))
	}

	// Push after clear should work normally
	rb.Push("d")
	if rb.Len() != 1 {
		t.Errorf("after Clear+Push, Len() = %d, want 1", rb.Len())
	}
}

func TestRingBuffer_Items_returns_copy(t *testing.T) {
	rb := NewRingBuffer[int](5)
	rb.Push(1)
	rb.Push(2)

	items := rb.Items()
	items[0] = 99

	original := rb.Items()
	if original[0] != 1 {
		t.Error("Items() did not return a copy; mutation affected internal state")
	}
}

func TestRingBuffer_All(t *testing.T) {
	rb := NewRingBuffer[int](5)
	rb.Push(1)
	rb.Push(2)
	rb.Push(3)

	var collected []int
	rb.All(func(v int) bool {
		collected = append(collected, v)
		return true
	})

	if len(collected) != 3 {
		t.Fatalf("All() visited %d items, want 3", len(collected))
	}
	for i, want := range []int{1, 2, 3} {
		if collected[i] != want {
			t.Errorf("All() item[%d] = %d, want %d", i, collected[i], want)
		}
	}
}

func TestRingBuffer_All_early_stop(t *testing.T) {
	rb := NewRingBuffer[int](5)
	rb.Push(1)
	rb.Push(2)
	rb.Push(3)

	var collected []int
	rb.All(func(v int) bool {
		collected = append(collected, v)
		return v != 2 // stop after seeing 2
	})

	if len(collected) != 2 {
		t.Fatalf("All() with early stop visited %d items, want 2", len(collected))
	}
}
