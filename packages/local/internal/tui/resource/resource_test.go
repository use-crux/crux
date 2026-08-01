package resource

import (
	"context"
	"errors"
	"testing"
)

func TestResourceInitialLoadBecomesReady(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-2"}

	_, token := res.Begin(context.Background(), owner, 7)
	if got := res.Snapshot().State; got != ResourceLoading {
		t.Fatalf("state after Begin = %v, want loading", got)
	}
	if accepted := res.Apply(ResourceResult[string]{Token: token, Value: "diagnosis"}); !accepted {
		t.Fatal("current successful result was rejected")
	}

	snapshot := res.Snapshot()
	if snapshot.State != ResourceReady {
		t.Fatalf("state = %v, want ready", snapshot.State)
	}
	if !snapshot.HasValue || snapshot.Value != "diagnosis" {
		t.Fatalf("value = (%q, %v), want diagnosis", snapshot.Value, snapshot.HasValue)
	}
	if snapshot.Refreshing {
		t.Fatal("completed initial load remained refreshing")
	}
	if snapshot.Err != nil {
		t.Fatalf("successful load error = %v", snapshot.Err)
	}
}

func TestResourceSuccessfulSemanticEmpty(t *testing.T) {
	res := New(func(values []string) bool { return len(values) == 0 })
	_, token := res.Begin(context.Background(), ResourceOwner{Screen: "runs", Resource: "list"}, 1)

	if accepted := res.Apply(ResourceResult[[]string]{Token: token, Value: []string{}}); !accepted {
		t.Fatal("current empty result was rejected")
	}

	snapshot := res.Snapshot()
	if snapshot.State != ResourceEmpty {
		t.Fatalf("state = %v, want empty", snapshot.State)
	}
	if !snapshot.HasValue {
		t.Fatal("successful empty result was not retained")
	}
}

func TestResourceRefreshPreservesLastGoodValue(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-2"}
	_, initial := res.Begin(context.Background(), owner, 1)
	res.Apply(ResourceResult[string]{Token: initial, Value: "last good"})

	_, refresh := res.Begin(context.Background(), owner, 2)

	snapshot := res.Snapshot()
	if snapshot.State != ResourceReady {
		t.Fatalf("refresh state = %v, want ready with stale value", snapshot.State)
	}
	if !snapshot.Refreshing {
		t.Fatal("replacement request did not mark resource refreshing")
	}
	if !snapshot.HasValue || snapshot.Value != "last good" {
		t.Fatalf("refresh value = (%q, %v), want last good", snapshot.Value, snapshot.HasValue)
	}
	if snapshot.Token != refresh {
		t.Fatalf("snapshot token = %#v, want refresh token %#v", snapshot.Token, refresh)
	}
}

func TestResourceOwnerChangeDiscardsPreviousOwnersValue(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	ownerA := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-a"}
	ownerB := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-b"}
	_, requestA := res.Begin(context.Background(), ownerA, 1)
	res.Apply(ResourceResult[string]{Token: requestA, Value: "run A detail"})

	_, requestB := res.Begin(context.Background(), ownerB, 1)
	loading := res.Snapshot()
	if loading.State != ResourceLoading || loading.HasValue || loading.Refreshing {
		t.Fatalf("new owner state = %#v, want initial loading without run A data", loading)
	}

	wantErr := errors.New("run B unavailable")
	if accepted := res.Apply(ResourceResult[string]{Token: requestB, Err: wantErr}); !accepted {
		t.Fatal("current run B failure was rejected")
	}
	failed := res.Snapshot()
	if failed.State != ResourceFailed || failed.HasValue || failed.Value != "" {
		t.Fatalf("new owner failure = %#v, want failed without run A data", failed)
	}
}

func TestResourceRefreshFailureDegradesLastGoodValue(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-2"}
	_, initial := res.Begin(context.Background(), owner, 1)
	res.Apply(ResourceResult[string]{Token: initial, Value: "last good"})
	_, refresh := res.Begin(context.Background(), owner, 2)
	wantErr := errors.New("refresh unavailable")

	if accepted := res.Apply(ResourceResult[string]{Token: refresh, Err: wantErr}); !accepted {
		t.Fatal("current refresh failure was rejected")
	}

	snapshot := res.Snapshot()
	if snapshot.State != ResourceDegraded {
		t.Fatalf("state = %v, want degraded", snapshot.State)
	}
	if !snapshot.HasValue || snapshot.Value != "last good" {
		t.Fatalf("degraded value = (%q, %v), want last good", snapshot.Value, snapshot.HasValue)
	}
	if !errors.Is(snapshot.Err, wantErr) {
		t.Fatalf("error = %v, want %v", snapshot.Err, wantErr)
	}
	if snapshot.Refreshing {
		t.Fatal("failed refresh remained refreshing")
	}
}

func TestResourceInitialFailureHasNoValue(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	_, token := res.Begin(context.Background(), ResourceOwner{Screen: "runs", Resource: "list"}, 1)
	wantErr := errors.New("server unavailable")

	if accepted := res.Apply(ResourceResult[string]{Token: token, Err: wantErr}); !accepted {
		t.Fatal("current initial failure was rejected")
	}

	snapshot := res.Snapshot()
	if snapshot.State != ResourceFailed {
		t.Fatalf("state = %v, want failed", snapshot.State)
	}
	if snapshot.HasValue {
		t.Fatalf("initial failure unexpectedly retained value %q", snapshot.Value)
	}
	if !errors.Is(snapshot.Err, wantErr) {
		t.Fatalf("error = %v, want %v", snapshot.Err, wantErr)
	}
}

func TestResourceExpectedCancellationIsSilent(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "overview", Resource: "summary"}
	_, token := res.Begin(context.Background(), owner, 1)

	if accepted := res.Apply(ResourceResult[string]{Token: token, Err: context.Canceled}); accepted {
		t.Fatal("expected cancellation was accepted as a presentation result")
	}
	snapshot := res.Snapshot()
	if snapshot.State != ResourceIdle || snapshot.HasValue || snapshot.Refreshing || snapshot.Err != nil {
		t.Fatalf("state after expected cancellation = %#v, want silent idle resource", snapshot)
	}
}

func TestResourceCanceledRefreshPreservesLastGoodValue(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "overview", Resource: "summary"}
	_, initial := res.Begin(context.Background(), owner, 1)
	res.Apply(ResourceResult[string]{Token: initial, Value: "last good"})
	_, refresh := res.Begin(context.Background(), owner, 2)

	if accepted := res.Apply(ResourceResult[string]{Token: refresh, Err: context.Canceled}); accepted {
		t.Fatal("canceled refresh was accepted as a presentation result")
	}
	snapshot := res.Snapshot()
	if snapshot.State != ResourceReady || !snapshot.HasValue || snapshot.Value != "last good" || snapshot.Refreshing || snapshot.Err != nil {
		t.Fatalf("state after canceled refresh = %#v, want last-good ready resource", snapshot)
	}
}

func TestResourceReplacementCancelsPreviousContext(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-1"}
	previousCtx, _ := res.Begin(context.Background(), owner, 1)

	res.Begin(context.Background(), owner, 2)

	select {
	case <-previousCtx.Done():
	default:
		t.Fatal("replacement request did not cancel previous context")
	}
}

func TestResourceRejectsObsoleteRequest(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-1"}
	_, obsolete := res.Begin(context.Background(), owner, 1)
	_, current := res.Begin(context.Background(), owner, 2)

	if accepted := res.Apply(ResourceResult[string]{Token: obsolete, Value: "obsolete"}); accepted {
		t.Fatal("obsolete request result was accepted")
	}

	snapshot := res.Snapshot()
	if snapshot.State != ResourceLoading || snapshot.HasValue {
		t.Fatalf("state after obsolete result = %#v, want current request still loading", snapshot)
	}
	if snapshot.Token != current {
		t.Fatalf("token = %#v, want current %#v", snapshot.Token, current)
	}
}

func TestResourceRejectsOwnerMismatch(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-1"}
	_, token := res.Begin(context.Background(), owner, 1)
	mismatched := token
	mismatched.Owner.RecordID = "run-2"

	if accepted := res.Apply(ResourceResult[string]{Token: mismatched, Value: "wrong owner"}); accepted {
		t.Fatal("owner-mismatched result was accepted")
	}
	if snapshot := res.Snapshot(); snapshot.State != ResourceLoading || snapshot.HasValue {
		t.Fatalf("state after owner mismatch = %#v, want loading without value", snapshot)
	}
}

func TestResourceRejectsStaleRevision(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "detail", RecordID: "run-1"}
	_, token := res.Begin(context.Background(), owner, 9)
	stale := token
	stale.Revision = 8

	if accepted := res.Apply(ResourceResult[string]{Token: stale, Value: "stale"}); accepted {
		t.Fatal("stale revision was accepted")
	}
	if snapshot := res.Snapshot(); snapshot.State != ResourceFailed || snapshot.HasValue || snapshot.Refreshing || !errors.Is(snapshot.Err, ErrStaleRevision) {
		t.Fatalf("state after stale revision = %#v, want terminal stale failure", snapshot)
	}
}

func TestResourceCancelIsIdempotentAndRejectsLateResult(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	ctx, token := res.Begin(context.Background(), ResourceOwner{Screen: "runs", Resource: "list"}, 1)

	res.Cancel()
	res.Cancel()

	select {
	case <-ctx.Done():
	default:
		t.Fatal("Cancel did not cancel the active child context")
	}
	if accepted := res.Apply(ResourceResult[string]{Token: token, Value: "late"}); accepted {
		t.Fatal("result arriving after Cancel was accepted")
	}
}

func TestResourceDiscardForgetsLastGoodAndRejectsPreDiscardResult(t *testing.T) {
	res := New(func(value string) bool { return value == "" })
	owner := ResourceOwner{Screen: "runs", Resource: "list"}
	_, initial := res.Begin(context.Background(), owner, 1)
	res.Apply(ResourceResult[string]{Token: initial, Value: "last good"})
	_, obsolete := res.Begin(context.Background(), owner, 2)

	res.Discard()
	_, current := res.Begin(context.Background(), owner, 3)
	if accepted := res.Apply(ResourceResult[string]{Token: obsolete, Value: "obsolete"}); accepted {
		t.Fatal("pre-discard result was accepted")
	}
	snapshot := res.Snapshot()
	if snapshot.State != ResourceLoading || snapshot.HasValue || snapshot.Token != current {
		t.Fatalf("post-discard snapshot = %#v, want fresh loading request", snapshot)
	}
}
