package store

// RingBuffer is a bounded FIFO buffer that evicts the oldest items when full.
type RingBuffer[T any] struct {
	items []T
	max   int
}

// NewRingBuffer creates a ring buffer with the given maximum capacity.
func NewRingBuffer[T any](max int) *RingBuffer[T] {
	return &RingBuffer[T]{
		items: make([]T, 0, max),
		max:   max,
	}
}

// Push adds an item to the buffer. If the buffer is at capacity,
// the oldest item is evicted.
func (rb *RingBuffer[T]) Push(item T) {
	if len(rb.items) >= rb.max {
		// Shift left by 1, dropping the oldest element
		copy(rb.items, rb.items[1:])
		rb.items[len(rb.items)-1] = item
	} else {
		rb.items = append(rb.items, item)
	}
}

// Items returns a copy of all items in insertion order (oldest first).
func (rb *RingBuffer[T]) Items() []T {
	out := make([]T, len(rb.items))
	copy(out, rb.items)
	return out
}

// Len returns the number of items currently in the buffer.
func (rb *RingBuffer[T]) Len() int {
	return len(rb.items)
}

// Clear removes all items from the buffer.
func (rb *RingBuffer[T]) Clear() {
	rb.items = rb.items[:0]
}

// Last returns the most recently added item and true, or the zero value
// and false if the buffer is empty.
func (rb *RingBuffer[T]) Last() (T, bool) {
	if len(rb.items) == 0 {
		var zero T
		return zero, false
	}
	return rb.items[len(rb.items)-1], true
}

// All calls fn for each item in order. If fn returns false, iteration stops.
func (rb *RingBuffer[T]) All(fn func(T) bool) {
	for _, item := range rb.items {
		if !fn(item) {
			return
		}
	}
}
