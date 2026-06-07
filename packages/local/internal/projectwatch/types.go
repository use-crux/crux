package projectwatch

import "time"

// Delta is the debounced set of project files that changed since the previous
// indexing run. Paths are absolute, cleaned paths so the indexer can normalize
// them against the configured project root.
type Delta struct {
	Files        []string
	DeletedFiles []string
}

// Options configures a project filesystem watcher.
type Options struct {
	Root     string
	Debounce time.Duration
	OnDelta  func(Delta)
}
