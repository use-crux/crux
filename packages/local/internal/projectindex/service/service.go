package service

import (
	"context"
	"path/filepath"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
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
	// StrictCache turns cache read/write failures into indexing failures. It is
	// used by bounded CI commands whose exit contract reports integrity errors.
	StrictCache bool
	// ReadModel returns the host-enriched read model. When omitted, Store is read
	// directly.
	ReadModel ReadModelFunc
	// Publish receives every applied Project Index snapshot.
	Publish PublishFunc
}

// Service owns Project Index reindex, watch, semantic, lint, and runtime
// orchestration for the local runtime.
type Service struct {
	ctx                      context.Context
	store                    SnapshotStore
	indexer                  ASTClient
	indexCache               *cache.Cache
	indexMu                  sync.Mutex
	indexState               *projectindex.State
	runtimeSnapshot          *store.IndexData
	runtimeOverlays          *projectindex.RuntimeOverlayState
	authoritativeASTObserved bool
	watchStatus              projectIndexWatchStatusStore
	configDependenciesMu     sync.RWMutex
	configDependenciesByRoot map[string][]string
	readModel                ReadModelFunc
	publish                  PublishFunc

	semanticModeMu sync.RWMutex
	semanticMode   ProjectSemanticExecutionMode

	backgroundSemanticMu     sync.Mutex
	backgroundSemanticCancel func()
	backgroundSemanticSeq    uint64
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
		facts = cache.NewSQLiteIndexFactStore()
	}
	return &Service{
		ctx:                      ctx,
		store:                    indexStore,
		indexer:                  options.Indexer,
		indexCache:               cache.NewCache(facts, options.StrictCache),
		indexState:               projectindex.NewState(),
		configDependenciesByRoot: map[string][]string{},
		runtimeOverlays:          projectindex.NewRuntimeOverlayState(),
		readModel:                options.ReadModel,
		publish:                  options.Publish,
	}
}

func (s *Service) setConfigDependencies(root string, dependencies []string) {
	s.configDependenciesMu.Lock()
	s.configDependenciesByRoot[filepath.Clean(root)] = append([]string(nil), dependencies...)
	s.configDependenciesMu.Unlock()
}

func (s *Service) configDependencies(root string) []string {
	s.configDependenciesMu.RLock()
	defer s.configDependenciesMu.RUnlock()
	return append([]string(nil), s.configDependenciesByRoot[filepath.Clean(root)]...)
}

// WithProjectIndexer replaces the phase clients used for future indexing work.
func (s *Service) WithProjectIndexer(indexer ASTClient) *Service {
	s.indexer = indexer
	return s
}

// WithFactStore replaces the cache transaction store used for future runs.
func (s *Service) WithFactStore(facts CacheStore) *Service {
	if s.indexCache == nil {
		s.indexCache = cache.NewCache(facts)
	} else {
		s.indexCache.SetFactStore(facts)
	}
	return s
}

// HasProjectIndexer reports whether an AST phase client is configured.
func (s *Service) HasProjectIndexer() bool {
	return s != nil && s.indexer != nil
}

// AcquireEvalDiscoveryCapacity atomically admits Eval discovery against
// saturated semantic compiler work. Alternate indexers need no coordination.
func (s *Service) AcquireEvalDiscoveryCapacity(ctx context.Context) (func(), error) {
	if s == nil {
		return func() {}, nil
	}
	capacity, ok := s.indexer.(EvalDiscoveryCapacity)
	if !ok {
		return func() {}, nil
	}
	return capacity.AcquireEvalDiscoveryCapacity(ctx)
}

// AcquireContendedCompilerCapacity serializes another CPU-heavy compiler with
// Eval discovery when this project has saturated semantic worker capacity.
func (s *Service) AcquireContendedCompilerCapacity(ctx context.Context) (func(), error) {
	if s == nil {
		return func() {}, nil
	}
	capacity, ok := s.indexer.(ContendedCompilerCapacity)
	if !ok || !capacity.EvalDiscoveryIsolationRequired() {
		return func() {}, nil
	}
	return capacity.AcquireContendedCompilerCapacity(ctx)
}

// EvalDiscoveryIsolationRequired reports whether large-project compiler work
// needs to be sequenced with Eval discovery.
func (s *Service) EvalDiscoveryIsolationRequired() bool {
	if s == nil {
		return false
	}
	capacity, ok := s.indexer.(ContendedCompilerCapacity)
	return ok && capacity.EvalDiscoveryIsolationRequired()
}

// WatchStatus returns a clone of the latest watcher scheduling status.
func (s *Service) WatchStatus() api.ProjectIndexWatchStatus {
	if s == nil {
		return api.ProjectIndexWatchStatus{State: "idle"}
	}
	return s.watchStatus.Snapshot()
}

// SemanticMode returns the most recently requested semantic execution mode.
// An empty value means no refresh has established a mode yet.
func (s *Service) SemanticMode() ProjectSemanticExecutionMode {
	if s == nil {
		return ""
	}
	s.semanticModeMu.RLock()
	defer s.semanticModeMu.RUnlock()
	return s.semanticMode
}

func (s *Service) setSemanticMode(mode ProjectSemanticExecutionMode) {
	s.semanticModeMu.Lock()
	s.semanticMode = mode
	s.semanticModeMu.Unlock()
}

// DefinitionEvidence returns durable compiler provenance linked to one current
// Catalog definition. It does not inspect source or compiler AST objects.
func (s *Service) DefinitionEvidence(ctx context.Context, root, definitionID string) ([]projectindex.IndexFactEnvelope, error) {
	if s == nil || s.indexCache == nil {
		return []projectindex.IndexFactEnvelope{}, nil
	}
	return s.indexCache.DefinitionEvidence(ctx, root, definitionID)
}
