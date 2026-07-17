package readmodel

import (
	"io/fs"
	"os"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// RunSource provides an atomic snapshot of the raw index and in-memory runs.
type RunSource interface {
	Snapshot() (index store.IndexData, evals []store.EvalRun, rags []store.RagEvalRun, flows []store.FlowRun)
}

type statFunc func(string) (fs.FileInfo, error)

// Model owns the Project Index read model enrichment pipeline.
type Model struct {
	runs RunSource
	stat statFunc
}

// Option customizes Model.
type Option func(*Model)

// WithStat injects filesystem stat behavior for tests.
func WithStat(stat statFunc) Option {
	return func(m *Model) {
		if stat != nil {
			m.stat = stat
		}
	}
}

// New wires the default fully-enriched Project Index read model.
func New(runs RunSource, opts ...Option) *Model {
	m := &Model{
		runs: runs,
		stat: os.Stat,
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Raw returns the un-enriched index snapshot for cache writes and snapshot merges.
func (m *Model) Raw() store.IndexData {
	if m == nil || m.runs == nil {
		return store.IndexData{}
	}
	index, _, _, _ := m.runs.Snapshot()
	return index
}

// Index runs all read-model enrichment passes in fixed order:
//  1. in-memory eval/rag/flow run joins
//  2. source mtime metadata, safety target metadata, and storage summaries
func (m *Model) Index() store.IndexData {
	if m == nil || m.runs == nil {
		return store.IndexData{}
	}
	index, evals, rags, flows := m.runs.Snapshot()
	index = enrichRuns(index, evals, rags, flows)
	applyIndexLintPolicy(&index)
	index = enrichDefinitionUpdated(index, m.stat)
	index = enrichSafetyTargets(index)
	return enrichStorage(index)
}
