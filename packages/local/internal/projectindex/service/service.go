package service

import (
	"context"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ReadModelFunc returns the current Project Index snapshot visible to callers.
type ReadModelFunc func() store.IndexData

// PublishFunc publishes a changed Project Index snapshot to interested hosts.
type PublishFunc func(store.IndexData)

// Options configures a Project Index orchestration service.
type Options struct {
	// Context bounds background semantic work started by the service.
	Context context.Context
	// Store persists the latest durable Project Index snapshot.
	Store SnapshotStore
	// Indexer provides the concrete AST, semantic, runtime, lint, and watch
	// phase clients used by the scheduler.
	Indexer ASTClient
	// FactStore persists phase transactions for cache warm starts.
	FactStore CacheStore
	// ReadModel returns the host-enriched read model. When omitted, Store is read
	// directly.
	ReadModel ReadModelFunc
	// Publish receives every applied Project Index snapshot.
	Publish PublishFunc
}

// Service owns Project Index reindex, watch, semantic, lint, and runtime
// orchestration for the local runtime.
type Service struct {
	ctx         context.Context
	store       SnapshotStore
	indexer     ASTClient
	indexCache  *projectindex.Cache
	indexMu     sync.Mutex
	indexState  *projectindex.State
	watchStatus projectIndexWatchStatusStore
	readModel   ReadModelFunc
	publish     PublishFunc
}

// New creates a Project Index orchestration service.
func New(options Options) *Service {
	ctx := options.Context
	if ctx == nil {
		ctx = context.Background()
	}
	indexStore := options.Store
	if indexStore == nil {
		indexStore = store.NewStore()
	}
	facts := options.FactStore
	if facts == nil {
		facts = projectindex.NewSQLiteIndexFactStore()
	}
	return &Service{
		ctx:        ctx,
		store:      indexStore,
		indexer:    options.Indexer,
		indexCache: projectindex.NewCache(facts),
		indexState: projectindex.NewState(),
		readModel:  options.ReadModel,
		publish:    options.Publish,
	}
}

// WithProjectIndexer replaces the phase clients used for future indexing work.
func (s *Service) WithProjectIndexer(indexer ASTClient) *Service {
	s.indexer = indexer
	return s
}

// WithFactStore replaces the cache transaction store used for future runs.
func (s *Service) WithFactStore(facts CacheStore) *Service {
	if s.indexCache == nil {
		s.indexCache = projectindex.NewCache(facts)
	} else {
		s.indexCache.SetFactStore(facts)
	}
	return s
}

// HasProjectIndexer reports whether an AST phase client is configured.
func (s *Service) HasProjectIndexer() bool {
	return s != nil && s.indexer != nil
}

// WatchStatus returns a clone of the latest watcher scheduling status.
func (s *Service) WatchStatus() api.ProjectIndexWatchStatus {
	if s == nil {
		return api.ProjectIndexWatchStatus{State: "idle"}
	}
	return s.watchStatus.Snapshot()
}

// ApplyIndexPatch applies a phase patch and publishes the resulting snapshot.
func (s *Service) ApplyIndexPatch(_ context.Context, patch projectindex.IndexPatch) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.applyIndexPatchLocked(patch)
}

func (s *Service) applyIndexPatchLocked(patch projectindex.IndexPatch) store.IndexData {
	applied := s.indexState.Apply(patch)
	s.store.SetIndexData(applied)
	index := s.indexReadModel()
	s.publishIndex(index)
	return index
}

func (s *Service) indexReadModel() store.IndexData {
	if s.readModel != nil {
		return s.readModel()
	}
	return s.store.GetIndex()
}

func (s *Service) publishIndex(index store.IndexData) {
	if s.publish != nil {
		s.publish(index)
	}
}
