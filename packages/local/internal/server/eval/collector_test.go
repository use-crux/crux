package eval

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
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

func TestCollectorUsesCLIDiscoverySemantics(t *testing.T) {
	worker := t.TempDir() + "/coordinator"
	if err := os.WriteFile(worker, []byte("#!/bin/sh\n[ \"$2\" = \"--list\" ] || exit 9\nprintf '%s\\n' '{\"type\":\"collect:done\",\"evals\":[{\"id\":\"support\"}],\"errors\":[]}' '{\"type\":\"run:done\",\"exitCode\":0}'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	collector := NewCollector(t.TempDir(), CollectorDeps{
		FindNode:           func() (string, error) { return worker, nil },
		ExtractCoordinator: func() (string, error) { return "ignored", nil },
	})
	manifests, err := collector.EvalManifests(t.Context())
	if err != nil || len(manifests) != 1 {
		t.Fatalf("manifests = %s, err = %v", manifests, err)
	}
}

func TestCollectorBoundsWorkerFailure(t *testing.T) {
	worker := t.TempDir() + "/coordinator"
	if err := os.WriteFile(worker, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	collector := NewCollector("", CollectorDeps{})
	collector.timeout = 20 * time.Millisecond
	collector.deps.FindNode = func() (string, error) { return worker, nil }
	collector.deps.ExtractCoordinator = func() (string, error) { return "ignored", nil }
	collector.collect = collector.collectFromWorker
	started := time.Now()
	_, err := collector.EvalManifests(t.Context())
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("error = %v, want readable timeout", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("bounded failure took %s", elapsed)
	}
}

func TestCollectorCoalescesConcurrentWorkerFailure(t *testing.T) {
	collector := NewCollector("", CollectorDeps{})
	started := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	collector.collect = func(context.Context) ([]json.RawMessage, error) {
		calls++
		close(started)
		<-release
		return nil, errors.New("worker failed")
	}

	type result struct {
		err error
	}
	results := make(chan result, 2)
	go func() {
		_, err := collector.EvalManifests(t.Context())
		results <- result{err: err}
	}()
	<-started
	go func() {
		_, err := collector.EvalManifests(t.Context())
		results <- result{err: err}
	}()
	deadline := time.Now().Add(time.Second)
	for {
		collector.mu.Lock()
		waiting := collector.inflight != nil && collector.inflight.waiters == 1
		collector.mu.Unlock()
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("second reader did not join the in-flight collection")
		}
		time.Sleep(time.Millisecond)
	}
	close(release)

	for range 2 {
		if got := <-results; got.err == nil || got.err.Error() != "worker failed" {
			t.Fatalf("coalesced error = %v", got.err)
		}
	}
	if calls != 1 {
		t.Fatalf("worker calls = %d, want one shared failure", calls)
	}
}

func TestCollectorCancellationDoesNotPoisonSharedFlight(t *testing.T) {
	collector := NewCollector("", CollectorDeps{})
	started := make(chan struct{})
	release := make(chan struct{})
	collector.collect = func(context.Context) ([]json.RawMessage, error) {
		close(started)
		<-release
		return []json.RawMessage{json.RawMessage(`{"id":"shared"}`)}, nil
	}

	leaderCtx, cancelLeader := context.WithCancel(t.Context())
	leader := make(chan error, 1)
	go func() {
		_, err := collector.EvalManifests(leaderCtx)
		leader <- err
	}()
	<-started
	waiter := make(chan []json.RawMessage, 1)
	go func() {
		manifests, _ := collector.EvalManifests(t.Context())
		waiter <- manifests
	}()

	deadline := time.Now().Add(time.Second)
	for {
		collector.mu.Lock()
		waiting := collector.inflight != nil && collector.inflight.waiters == 1
		collector.mu.Unlock()
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("second reader did not join the in-flight collection")
		}
		time.Sleep(time.Millisecond)
	}
	cancelLeader()
	if err := <-leader; !errors.Is(err, context.Canceled) {
		t.Fatalf("leader error = %v, want canceled", err)
	}
	close(release)
	if manifests := <-waiter; len(manifests) != 1 || string(manifests[0]) != `{"id":"shared"}` {
		t.Fatalf("waiter manifests = %s", manifests)
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

func TestCollectorReusesRecentCatalogWrittenByAnotherProcess(t *testing.T) {
	root := t.TempDir()
	want := []json.RawMessage{json.RawMessage(`{"id":"shared"}`)}
	if err := StoreCatalogCache(root, want, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	collector := NewFreshCollector(root, CollectorDeps{})
	collector.collect = func(context.Context) ([]json.RawMessage, error) {
		t.Fatal("recent shared cache started a discovery worker")
		return nil, nil
	}
	got, err := collector.EvalManifests(t.Context())
	if err != nil || len(got) != 1 || string(got[0]) != string(want[0]) {
		t.Fatalf("shared catalog = %s, err = %v", got, err)
	}
}

func TestCatalogCacheRejectsExpiredCrossProcessSnapshot(t *testing.T) {
	root := t.TempDir()
	if err := StoreCatalogCache(root, []json.RawMessage{json.RawMessage(`{"id":"stale"}`)}, time.Now().Add(-catalogCacheTTL-time.Second)); err != nil {
		t.Fatal(err)
	}
	got, _, err := LoadCatalogCache(root, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("expired shared catalog = %s, want cache miss", got)
	}
}

func TestCollectorReusesAuthoritativeEmptyCatalog(t *testing.T) {
	root := t.TempDir()
	if err := StoreCatalogCache(root, nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	collector := NewFreshCollector(root, CollectorDeps{})
	collector.collect = func(context.Context) ([]json.RawMessage, error) {
		t.Fatal("authoritative empty cache started a discovery worker")
		return nil, nil
	}
	got, err := collector.EvalManifests(t.Context())
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("shared empty catalog = %#v, err = %v", got, err)
	}
}

func TestCollectorWaitsForStartupBeforeStartingNodeDiscovery(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	collector := NewCollector("", CollectorDeps{WaitForStartup: func(ctx context.Context) error {
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}})
	collector.timeout = time.Second
	collector.deps.FindNode = func() (string, error) {
		close(started)
		return "", errors.New("stop after admission check")
	}
	collector.collect = collector.collectFromWorker
	done := make(chan error, 1)
	go func() {
		_, err := collector.EvalManifests(t.Context())
		done <- err
	}()
	select {
	case <-started:
		t.Fatal("Node discovery competed with startup")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-done; err == nil || !strings.Contains(err.Error(), "stop after admission") {
		t.Fatalf("post-startup discovery error = %v", err)
	}
}

func TestCollectorGivesDiscoveryAFreshTimeoutAfterStartup(t *testing.T) {
	worker := t.TempDir() + "/coordinator"
	if err := os.WriteFile(worker, []byte("#!/bin/sh\nsleep 0.12\nprintf '%s\\n' '{\"type\":\"collect:done\",\"evals\":[],\"errors\":[]}' '{\"type\":\"run:done\",\"exitCode\":0}'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	collector := NewCollector(t.TempDir(), CollectorDeps{
		WaitForStartup: func(ctx context.Context) error {
			select {
			case <-time.After(170 * time.Millisecond):
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
		FindNode:           func() (string, error) { return worker, nil },
		ExtractCoordinator: func() (string, error) { return "ignored", nil },
	})
	collector.timeout = 250 * time.Millisecond
	collector.collect = collector.collectFromWorker

	startedAt := time.Now()
	manifests, err := collector.EvalManifests(t.Context())
	if err != nil || manifests == nil {
		t.Fatalf("manifests = %#v, err = %v", manifests, err)
	}
	if elapsed := time.Since(startedAt); elapsed < 270*time.Millisecond {
		t.Fatalf("segmented startup and discovery elapsed = %s, want both stages", elapsed)
	}
}

func TestCollectorBoundsStartupWaitWithReadableRetry(t *testing.T) {
	collector := NewCollector("", CollectorDeps{WaitForStartup: func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}})
	collector.timeout = 20 * time.Millisecond
	collector.collect = collector.collectFromWorker
	_, err := collector.EvalManifests(t.Context())
	if err == nil || !strings.Contains(err.Error(), "retry when startup settles") {
		t.Fatalf("startup wait error = %v", err)
	}
}

func TestCollectorHoldsCompilerCapacityAcrossDiscovery(t *testing.T) {
	worker := t.TempDir() + "/coordinator"
	if err := os.WriteFile(worker, []byte("#!/bin/sh\nsleep 0.08\nprintf '%s\\n' '{\"type\":\"collect:done\",\"evals\":[],\"errors\":[]}' '{\"type\":\"run:done\",\"exitCode\":0}'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	held := make(chan struct{})
	released := make(chan struct{})
	collector := NewCollector(t.TempDir(), CollectorDeps{
		AcquireDiscovery: func(context.Context) (func(), error) {
			close(held)
			return func() { close(released) }, nil
		},
		FindNode:           func() (string, error) { return worker, nil },
		ExtractCoordinator: func() (string, error) { return "ignored", nil },
	})
	collector.collect = collector.collectFromWorker
	done := make(chan error, 1)
	go func() {
		_, err := collector.EvalManifests(t.Context())
		done <- err
	}()
	<-held
	select {
	case <-released:
		t.Fatal("compiler capacity released before discovery worker exited")
	case <-time.After(20 * time.Millisecond):
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("compiler capacity not released after discovery")
	}
}

func TestCollectorPreservesEarlierCallerDeadline(t *testing.T) {
	collector := NewCollector("", CollectorDeps{WaitForStartup: func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}})
	collector.timeout = time.Second
	collector.collect = collector.collectFromWorker
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err := collector.EvalManifests(ctx)
	if !errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "after 1s") {
		t.Fatalf("caller deadline error = %v", err)
	}
}

func TestCollectorFlightEndsWithOwningSession(t *testing.T) {
	lifetime, cancelLifetime := context.WithCancel(context.Background())
	started := make(chan struct{})
	collector := NewCollector("", CollectorDeps{Lifetime: lifetime})
	collector.collect = func(ctx context.Context) ([]json.RawMessage, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	done := make(chan error, 1)
	go func() {
		_, err := collector.EvalManifests(context.Background())
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("catalog flight did not start")
	}
	cancelLifetime()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("session-ended catalog error = %v, want canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("catalog flight outlived its owning session")
	}
}

func TestCollectorFlightUsesSessionWorkerAdmission(t *testing.T) {
	admitted := make(chan struct{}, 1)
	collector := NewCollector("", CollectorDeps{StartFlight: func(run func()) bool {
		admitted <- struct{}{}
		go run()
		return true
	}})
	collector.collect = func(context.Context) ([]json.RawMessage, error) { return []json.RawMessage{}, nil }
	if _, err := collector.EvalManifests(t.Context()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-admitted:
	default:
		t.Fatal("catalog flight bypassed session worker admission")
	}
}
