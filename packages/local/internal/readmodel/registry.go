package readmodel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
)

var ErrNotFound = errors.New("not found")

type badRequestError struct {
	message string
}

func (e badRequestError) Error() string {
	return e.message
}

func BadRequest(msg string) error {
	return badRequestError{message: msg}
}

type Req struct {
	Path      string
	PathValue func(name string) string
	Query     url.Values
}

type Params interface {
	Parse(Req) error
}

type Registry[D any] struct {
	endpoints []endpoint[D]
}

func NewRegistry[D any]() *Registry[D] {
	return &Registry[D]{}
}

func (r *Registry[D]) add(endpoint endpoint[D]) {
	r.endpoints = append(r.endpoints, endpoint)
}

func (r *Registry[D]) Endpoints() []endpoint[D] {
	out := make([]endpoint[D], len(r.endpoints))
	copy(out, r.endpoints)
	return out
}

type endpoint[D any] interface {
	Pattern() string
	Mount(*http.ServeMux, D, *slog.Logger)
}

type SnapshotSpec struct {
	Message    string
	Field      string
	AlwaysSend bool
}

type Snapshot struct {
	Pattern string
	Spec    SnapshotSpec
}

type SnapshotValue struct {
	Pattern string
	Spec    SnapshotSpec
	Value   any
	Err     error
}

type InvalidationSelector func(any) (map[string]any, bool)

type snapshotEndpoint interface {
	Snapshot() (SnapshotSpec, bool)
}

type invalidationEndpoint interface {
	InvalidationSelectors() []InvalidationSelector
}

type snapshotCaller[D any] interface {
	SnapshotCall(context.Context, D) (any, error)
}

type Handle[D, T any] struct {
	pattern      string
	aliases      []string
	call         func(context.Context, D) (T, error)
	snapshot     *SnapshotSpec
	invalidators []InvalidationSelector
}

type ParamHandle[D any, P Params, T any] struct {
	pattern   string
	newParams func() P
	call      func(context.Context, D, P) (T, error)
}

type Option[D, T any] func(*Handle[D, T])

func Alias[D, T any](pattern string) Option[D, T] {
	return func(h *Handle[D, T]) {
		h.aliases = append(h.aliases, pattern)
	}
}

func SnapshotIn[D, T any](message, field string) Option[D, T] {
	return func(h *Handle[D, T]) {
		h.snapshot = &SnapshotSpec{Message: message, Field: field}
	}
}

func SnapshotAlways[D, T any](message, field string) Option[D, T] {
	return func(h *Handle[D, T]) {
		h.snapshot = &SnapshotSpec{Message: message, Field: field, AlwaysSend: true}
	}
}

func InvalidatedBy[D, T any](selector InvalidationSelector) Option[D, T] {
	return func(h *Handle[D, T]) {
		h.invalidators = append(h.invalidators, selector)
	}
}

func Get[D, T any](reg *Registry[D], pattern string, call func(context.Context, D) (T, error), opts ...Option[D, T]) *Handle[D, T] {
	handle := &Handle[D, T]{pattern: pattern, call: call}
	for _, opt := range opts {
		opt(handle)
	}
	reg.add(handle)
	return handle
}

func (h *Handle[D, T]) Pattern() string {
	return h.pattern
}

func (h *Handle[D, T]) Snapshot() (SnapshotSpec, bool) {
	if h.snapshot == nil {
		return SnapshotSpec{}, false
	}
	return *h.snapshot, true
}

func (h *Handle[D, T]) InvalidationSelectors() []InvalidationSelector {
	out := make([]InvalidationSelector, len(h.invalidators))
	copy(out, h.invalidators)
	return out
}

func (h *Handle[D, T]) Call(ctx context.Context, deps D) (T, error) {
	return h.call(ctx, deps)
}

func (h *Handle[D, T]) SnapshotCall(ctx context.Context, deps D) (any, error) {
	return h.Call(ctx, deps)
}

func GetP[D any, P Params, T any](reg *Registry[D], pattern string, newParams func() P, call func(context.Context, D, P) (T, error)) *ParamHandle[D, P, T] {
	handle := &ParamHandle[D, P, T]{pattern: pattern, newParams: newParams, call: call}
	reg.add(handle)
	return handle
}

func (h *ParamHandle[D, P, T]) Pattern() string {
	return h.pattern
}

func (h *ParamHandle[D, P, T]) Call(ctx context.Context, deps D, params P) (T, error) {
	return h.call(ctx, deps, params)
}

func (r *Registry[D]) Snapshots() []Snapshot {
	out := []Snapshot{}
	for _, endpoint := range r.endpoints {
		snapshotEndpoint, ok := endpoint.(snapshotEndpoint)
		if !ok {
			continue
		}
		spec, ok := snapshotEndpoint.Snapshot()
		if !ok {
			continue
		}
		out = append(out, Snapshot{Pattern: endpoint.Pattern(), Spec: spec})
	}
	return out
}

func (r *Registry[D]) SnapshotValues(ctx context.Context, deps D, message string) []SnapshotValue {
	out := []SnapshotValue{}
	for _, endpoint := range r.endpoints {
		snapshotEndpoint, ok := endpoint.(snapshotEndpoint)
		if !ok {
			continue
		}
		spec, ok := snapshotEndpoint.Snapshot()
		if !ok || spec.Message != message {
			continue
		}
		caller, ok := endpoint.(snapshotCaller[D])
		if !ok {
			continue
		}
		value, err := caller.SnapshotCall(ctx, deps)
		out = append(out, SnapshotValue{
			Pattern: endpoint.Pattern(),
			Spec:    spec,
			Value:   value,
			Err:     err,
		})
	}
	return out
}

func (r *Registry[D]) InvalidationMessages(event any) []map[string]any {
	out := []map[string]any{}
	for _, endpoint := range r.endpoints {
		invalidators, ok := endpoint.(invalidationEndpoint)
		if !ok {
			continue
		}
		for _, selector := range invalidators.InvalidationSelectors() {
			if msg, ok := selector(event); ok {
				out = append(out, msg)
			}
		}
	}
	return out
}

type Limit struct {
	N       int
	Default int
}

func (p *Limit) Parse(req Req) error {
	raw := req.Query.Get("limit")
	if raw == "" {
		p.N = p.Default
		return nil
	}
	var n int
	if _, err := fmt.Sscanf(raw, "%d", &n); err != nil {
		return BadRequest("invalid limit")
	}
	p.N = n
	return nil
}

type PathID struct {
	Name string
	ID   string
}

func (p *PathID) Parse(req Req) error {
	if req.PathValue == nil {
		p.ID = ""
		return nil
	}
	p.ID = req.PathValue(p.Name)
	return nil
}
