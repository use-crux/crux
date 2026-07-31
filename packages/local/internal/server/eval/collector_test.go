package eval

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestCollectorCachesAdditiveCatalogAndServesLastGoodSnapshot(t *testing.T) {
	calls := 0
	collector := NewCollector("", CollectorDeps{})
	collector.ttl = time.Hour
	collector.collect = func(context.Context) ([]json.RawMessage, error) {
		calls++
		if calls > 1 {
			return nil, errors.New("refresh failed")
		}
		return []json.RawMessage{json.RawMessage(`{"id":"support","future":true}`)}, nil
	}

	first, err := collector.EvalManifests(context.Background())
	if err != nil || len(first) != 1 {
		t.Fatalf("first = %s, err = %v", first, err)
	}
	first[0][0] = '['
	second, err := collector.EvalManifests(context.Background())
	if err != nil || string(second[0]) != `{"id":"support","future":true}` || calls != 1 {
		t.Fatalf("second = %s, calls = %d, err = %v", second, calls, err)
	}
	collector.ttl = 0
	third, err := collector.EvalManifests(context.Background())
	if err != nil || string(third[0]) != `{"id":"support","future":true}` || calls != 2 {
		t.Fatalf("stale fallback = %s, calls = %d, err = %v", third, calls, err)
	}
}

func TestFreshCollectorCoalescesOneLoadThenRefreshes(t *testing.T) {
	normalCalls := 0
	normal := NewCollector("", CollectorDeps{})
	normal.collect = func(context.Context) ([]json.RawMessage, error) {
		normalCalls++
		return []json.RawMessage{json.RawMessage(`{"id":"cached"}`)}, nil
	}
	if _, err := normal.EvalManifests(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := normal.EvalManifests(context.Background()); err != nil {
		t.Fatal(err)
	}
	if normalCalls != 1 {
		t.Fatalf("normal collector calls = %d, want one call inside TTL", normalCalls)
	}

	freshCalls := 0
	fresh := NewFreshCollector("", CollectorDeps{})
	fresh.collect = func(context.Context) ([]json.RawMessage, error) {
		freshCalls++
		id := "first"
		if freshCalls == 2 {
			id = "updated"
		}
		return []json.RawMessage{json.RawMessage(`{"id":"` + id + `"}`)}, nil
	}
	first, err := fresh.EvalManifests(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := fresh.EvalManifests(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if freshCalls != 1 || string(first[0]) != `{"id":"first"}` ||
		string(second[0]) != `{"id":"first"}` {
		t.Fatalf("coalesced reads = %s then %s, calls = %d", first, second, freshCalls)
	}

	fresh.fetchedAt = fresh.fetchedAt.Add(-freshCollectorBurstTTL)
	third, err := fresh.EvalManifests(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if freshCalls != 2 || string(third[0]) != `{"id":"updated"}` {
		t.Fatalf("refreshed read = %s, calls = %d", third, freshCalls)
	}
}
