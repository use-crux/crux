// Package eval owns backend services for the Eval V1 Devtools surface.
package eval

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

type CollectorDeps struct {
	FindNode           func() (string, error)
	ExtractCoordinator func() (string, error)
	WaitForStartup     func(context.Context) error
	// Lifetime cancels shared flights when their owning dev session ends.
	Lifetime context.Context
	// StartFlight admits a discovery flight to the owning session worker group.
	StartFlight func(func()) bool
}

type Collector struct {
	projectRoot string
	deps        CollectorDeps
	ttl         time.Duration
	timeout     time.Duration
	collect     func(context.Context) ([]json.RawMessage, error)

	mu        sync.Mutex
	cached    []json.RawMessage
	fetchedAt time.Time
	inflight  *collectorFlight
	diskOnce  sync.Once
}

type collectorFlight struct {
	done      chan struct{}
	manifests []json.RawMessage
	err       error
	waiters   int
}

const collectorTTL = 15 * time.Second
const freshCollectorBurstTTL = 250 * time.Millisecond
const collectorTimeout = 30 * time.Second

// NewCollector creates a cached, discovery-only Eval catalog reader.
func NewCollector(projectRoot string, deps CollectorDeps) *Collector {
	collector := &Collector{projectRoot: projectRoot, deps: deps, ttl: collectorTTL, timeout: collectorTimeout}
	collector.collect = collector.collectFromWorker
	return collector
}

// NewFreshCollector creates a discovery reader that refreshes between user
// interactions while coalescing the catalog and Baseline reads in one UI load.
// It retains the latest successful snapshot as a fallback when collection fails.
func NewFreshCollector(projectRoot string, deps CollectorDeps) *Collector {
	collector := NewCollector(projectRoot, deps)
	collector.ttl = freshCollectorBurstTTL
	return collector
}

// EvalManifests returns additive worker projections without reinterpreting them.
func (c *Collector) EvalManifests(ctx context.Context) ([]json.RawMessage, error) {
	c.loadDiskCache()
	c.mu.Lock()
	if c.cached != nil && time.Since(c.fetchedAt) < c.ttl {
		cached := cloneRaw(c.cached)
		c.mu.Unlock()
		return cached, nil
	}
	if flight := c.inflight; flight != nil {
		flight.waiters++
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-flight.done:
			return cloneRaw(flight.manifests), flight.err
		}
	}
	flight := &collectorFlight{done: make(chan struct{})}
	c.inflight = flight
	c.mu.Unlock()
	flightCtx, cancelFlight := context.WithCancel(context.WithoutCancel(ctx))
	stopLifetime := func() bool { return false }
	if c.deps.Lifetime != nil {
		stopLifetime = context.AfterFunc(c.deps.Lifetime, cancelFlight)
	}
	run := func() {
		defer cancelFlight()
		defer stopLifetime()
		c.runFlight(flightCtx, flight)
	}
	if c.deps.StartFlight != nil {
		if !c.deps.StartFlight(run) {
			cancelFlight()
			c.rejectFlight(flight, errors.New("Eval catalog collector is shutting down"))
		}
	} else {
		go run()
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-flight.done:
		return cloneRaw(flight.manifests), flight.err
	}
}

func (c *Collector) rejectFlight(flight *collectorFlight, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.inflight != flight {
		return
	}
	flight.err = err
	c.inflight = nil
	close(flight.done)
}

func (c *Collector) runFlight(ctx context.Context, flight *collectorFlight) {
	manifests, err := c.collect(ctx)
	c.mu.Lock()
	if err != nil {
		if c.cached != nil {
			manifests, err = cloneRaw(c.cached), nil
		}
	} else {
		c.cached = cloneRaw(manifests)
		c.fetchedAt = time.Now()
		_ = StoreCatalogCache(c.projectRoot, manifests, c.fetchedAt)
	}
	flight.manifests = cloneRaw(manifests)
	flight.err = err
	c.inflight = nil
	close(flight.done)
	c.mu.Unlock()
}

func (c *Collector) collectFromWorker(ctx context.Context) ([]json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	if c.deps.WaitForStartup != nil {
		if err := c.deps.WaitForStartup(ctx); err != nil {
			return nil, fmt.Errorf("wait for startup before Eval catalog discovery: %w", err)
		}
	}
	node, err := c.deps.FindNode()
	if err != nil {
		return nil, err
	}
	coordinator, err := c.deps.ExtractCoordinator()
	if err != nil {
		return nil, err
	}
	var manifests []json.RawMessage
	var collectErrors []json.RawMessage
	found := false
	result, err := workerproc.Stream(ctx, workerproc.OneShot{
		CommandPath: node,
		CommandArgs: []string{coordinator},
		Args:        []string{"--list"},
		Dir:         c.projectRoot,
	}, func(raw json.RawMessage) error {
		var event struct {
			Type   string            `json:"type"`
			Evals  []json.RawMessage `json:"evals"`
			Errors []json.RawMessage `json:"errors"`
		}
		if json.Unmarshal(raw, &event) == nil && event.Type == "collect:done" {
			manifests, collectErrors, found = event.Evals, event.Errors, true
		}
		return nil
	})
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("Eval catalog discovery timed out after %s", c.timeout)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("Eval catalog worker produced no collect:done event")
	}
	if len(collectErrors) > 0 {
		return nil, fmt.Errorf("Eval catalog discovery failed: %s", collectErrors[0])
	}
	if result.ExitErr != nil {
		return nil, fmt.Errorf("Eval catalog worker failed: %w", result.ExitErr)
	}
	if manifests == nil {
		manifests = []json.RawMessage{}
	}
	return manifests, nil
}

func (c *Collector) loadDiskCache() {
	c.diskOnce.Do(func() {
		manifests, _, err := LoadCatalogCache(c.projectRoot, time.Now())
		if err != nil || manifests == nil {
			return
		}
		c.mu.Lock()
		c.cached = manifests
		// The disk layer already enforced its longer cross-process TTL. Treat
		// an accepted snapshot as newly admitted to this collector so the
		// fresh TUI collector can share it for its short burst window too.
		c.fetchedAt = time.Now()
		c.mu.Unlock()
	})
}

func cloneRaw(values []json.RawMessage) []json.RawMessage {
	result := make([]json.RawMessage, len(values))
	for index, value := range values {
		result[index] = append(json.RawMessage(nil), value...)
	}
	return result
}
