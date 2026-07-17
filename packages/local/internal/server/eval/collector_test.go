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
