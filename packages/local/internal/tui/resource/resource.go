// Package resource owns asynchronous request lifecycle state for TUI data.
// Workflow-specific projection and rendering remain with the consuming screen.
package resource

import (
	"context"
	"errors"
	"sync"
)

// ErrStaleRevision reports that a current request completed below its named
// freshness floor. The result is terminal for that request but never replaces
// the last-good value or lowers the retained floor.
var ErrStaleRevision = errors.New("resource result is older than requested revision")

// ResourceState is the presentation state of an asynchronous resource.
type ResourceState uint8

const (
	// ResourceIdle has not started a request.
	ResourceIdle ResourceState = iota
	// ResourceLoading has no usable value and is awaiting its first result.
	ResourceLoading
	// ResourceReady contains a current non-empty value.
	ResourceReady
	// ResourceEmpty is a successful result with caller-defined empty semantics.
	ResourceEmpty
	// ResourceDegraded retains a last-good value after a refresh failure.
	ResourceDegraded
	// ResourceFailed has no usable value and an actionable error.
	ResourceFailed
)

// ResourceOwner identifies the screen projection and optional record that owns
// a request.
type ResourceOwner struct {
	Screen   string
	Resource string
	RecordID string
}

// RequestToken carries the identity and freshness floor for one request.
type RequestToken struct {
	Owner    ResourceOwner
	Request  uint64
	Revision uint64
}

// ResourceResult is the value or error produced by one asynchronous request.
type ResourceResult[T any] struct {
	Token RequestToken
	Value T
	Err   error
}

// Snapshot is a point-in-time observation of a Resource.
type Snapshot[T any] struct {
	State      ResourceState
	Value      T
	HasValue   bool
	Err        error
	Refreshing bool
	Token      RequestToken
}

// Resource owns request identity, cancellation, freshness, and last-good
// presentation state for values of T.
type Resource[T any] struct {
	mu      sync.Mutex
	isEmpty func(T) bool

	request uint64
	token   RequestToken
	cancel  context.CancelFunc
	active  bool

	state      ResourceState
	value      T
	hasValue   bool
	err        error
	refreshing bool
}

// New constructs a Resource with explicit semantic-empty behavior.
func New[T any](isEmpty func(T) bool) *Resource[T] {
	if isEmpty == nil {
		panic("resource: empty predicate is required")
	}
	return &Resource[T]{isEmpty: isEmpty, state: ResourceIdle}
}

// Begin cancels the previous request and starts a child of parent.
func (r *Resource[T]) Begin(parent context.Context, owner ResourceOwner, revision uint64) (context.Context, RequestToken) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
	}
	if r.hasValue && owner != r.token.Owner {
		var zero T
		r.value = zero
		r.hasValue = false
	}
	ctx, cancel := context.WithCancel(parent)
	r.cancel = cancel
	r.request++
	r.token = RequestToken{Owner: owner, Request: r.request, Revision: revision}
	r.active = true
	r.err = nil
	if r.hasValue {
		r.state = ResourceReady
		if r.isEmpty(r.value) {
			r.state = ResourceEmpty
		}
		r.refreshing = true
	} else {
		r.state = ResourceLoading
		r.refreshing = false
	}
	return ctx, r.token
}

// Apply reduces a completed request into the resource state.
func (r *Resource[T]) Apply(result ResourceResult[T]) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.active || result.Token.Request != r.token.Request || result.Token.Owner != r.token.Owner {
		return false
	}
	if result.Token.Revision < r.token.Revision {
		r.err = ErrStaleRevision
		r.refreshing = false
		r.state = ResourceFailed
		if r.hasValue {
			r.state = ResourceDegraded
		}
		r.finishRequest()
		return false
	}
	r.token = result.Token
	if errors.Is(result.Err, context.Canceled) {
		r.err = nil
		r.refreshing = false
		r.state = ResourceIdle
		if r.hasValue {
			r.state = ResourceReady
			if r.isEmpty(r.value) {
				r.state = ResourceEmpty
			}
		}
		r.finishRequest()
		return false
	}
	if result.Err != nil {
		r.err = result.Err
		r.refreshing = false
		r.state = ResourceFailed
		if r.hasValue {
			r.state = ResourceDegraded
		}
		r.finishRequest()
		return true
	}
	r.value = result.Value
	r.hasValue = true
	r.err = nil
	r.refreshing = false
	r.state = ResourceReady
	if r.isEmpty(result.Value) {
		r.state = ResourceEmpty
	}
	r.finishRequest()
	return true
}

// Cancel stops and invalidates the active request. Repeated calls are safe.
func (r *Resource[T]) Cancel() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	r.active = false
	r.refreshing = false
}

// Discard cancels the current request and forgets its retained value. The
// request sequence remains monotonic so a result from before the discard can
// never collide with the next Begin.
func (r *Resource[T]) Discard() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	r.request++
	var zero T
	r.value = zero
	r.hasValue = false
	r.active = false
	r.state = ResourceIdle
	r.err = nil
	r.refreshing = false
}

func (r *Resource[T]) finishRequest() {
	r.active = false
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
}

// Snapshot returns a copy of the current lifecycle state.
func (r *Resource[T]) Snapshot() Snapshot[T] {
	r.mu.Lock()
	defer r.mu.Unlock()
	return Snapshot[T]{
		State:      r.state,
		Value:      r.value,
		HasValue:   r.hasValue,
		Err:        r.err,
		Refreshing: r.refreshing,
		Token:      r.token,
	}
}
