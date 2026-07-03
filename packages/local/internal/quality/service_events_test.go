package quality

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestServicePublishesInsightChangedAfterDerivationChanges(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dir := t.TempDir()
	svc := NewService(store.NewStore(), dir)
	events := svc.Events().Subscribe(ctx)
	if _, err := svc.Insights(ctx); err != nil {
		t.Fatal(err)
	}
	drainQualityEvents(events)

	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.CassetteIssue{
		Path:     "fixtures/sample.cassette.json",
		Status:   "missing",
		Kind:     "tool",
		TargetID: "docs_agent",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Insights(ctx); err != nil {
		t.Fatal(err)
	}

	event := waitQualityEvent(t, events, func(ev api.QualityEvent) bool {
		return ev.Kind == "insight" && ev.Action == "changed"
	})
	if event.RefID != "cassette-sample.cassette.json" {
		t.Fatalf("insight changed ref = %q, want cassette insight id", event.RefID)
	}
}

func TestServicePublishesCassetteDriftAfterSnapshotIssueChanges(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dir := t.TempDir()
	svc := NewService(store.NewStore(), dir)
	events := svc.Events().Subscribe(ctx)
	if _, err := svc.Insights(ctx); err != nil {
		t.Fatal(err)
	}
	drainQualityEvents(events)

	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.CassetteIssue{
		Path:     "fixtures/sample.cassette.json",
		Status:   "mismatch",
		Kind:     "tool",
		TargetID: "docs_agent",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Insights(ctx); err != nil {
		t.Fatal(err)
	}

	event := waitQualityEvent(t, events, func(ev api.QualityEvent) bool {
		return ev.Kind == "cassette" && ev.Action == "drift"
	})
	if event.RefID != "fixtures/sample.cassette.json" {
		t.Fatalf("cassette drift ref = %q, want cassette path", event.RefID)
	}
}

func waitQualityEvent(t *testing.T, events <-chan api.QualityEvent, match func(api.QualityEvent) bool) api.QualityEvent {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case ev := <-events:
			if match(ev) {
				return ev
			}
		case <-deadline:
			t.Fatal("timed out waiting for quality event")
		}
	}
}

func drainQualityEvents(events <-chan api.QualityEvent) {
	for {
		select {
		case <-events:
		default:
			return
		}
	}
}
