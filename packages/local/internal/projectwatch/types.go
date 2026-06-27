package projectwatch

import "time"

// Delta is the debounced set of project files that changed since the previous
// indexing run. Paths are absolute, cleaned paths so the indexer can normalize
// them against the configured project root.
type Delta struct {
	Files        []string
	DeletedFiles []string
}

// Run is one serialized incremental indexing attempt produced by the watcher
// queue. The ID is monotonically increasing for the lifetime of the runner.
type Run struct {
	ID    uint64
	Delta Delta
	Queue RunQueueStats
}

// RunQueueStats describes how file deltas were coalesced before a run started.
type RunQueueStats struct {
	DeltaBatchCount         int
	CoalescedWhileRunning   bool
	PendingRunReplacedCount int
}

// Options configures a project filesystem watcher.
type Options struct {
	Root     string
	Debounce time.Duration
	OnDelta  func(Delta)
}
