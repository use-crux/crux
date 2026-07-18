package readmodel

import (
	"io/fs"
	"os"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// IndexSource provides an atomic snapshot of the raw Project Index.
type IndexSource interface {
	Snapshot() store.IndexData
}

type statFunc func(string) (fs.FileInfo, error)

// Model owns the Project Index read model enrichment pipeline.
type Model struct {
	index IndexSource
	stat  statFunc
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
func New(index IndexSource, opts ...Option) *Model {
	m := &Model{
		index: index,
		stat:  os.Stat,
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Raw returns the un-enriched index snapshot for cache writes and snapshot merges.
func (m *Model) Raw() store.IndexData {
	if m == nil || m.index == nil {
		return store.IndexData{}
	}
	return m.index.Snapshot()
}

// Index runs all read-model enrichment passes in fixed order:
//  1. source mtime metadata and safety target metadata
//  2. storage summaries
func (m *Model) Index() store.IndexData {
	if m == nil || m.index == nil {
		return store.IndexData{}
	}
	index := m.index.Snapshot()
	applyIndexLintPolicy(&index)
	index = enrichDefinitionUpdated(index, m.stat)
	index = enrichSafetyTargets(index)
	return enrichStorage(index)
}
