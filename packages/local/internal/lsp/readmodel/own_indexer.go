package readmodel

import (
	"context"
	"fmt"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	projectwatchhost "github.com/use-crux/crux/packages/local/internal/projectwatch/host"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type ownIndexerSource struct {
	context   context.Context
	cancel    context.CancelFunc
	devtools  *devtools.Service
	closeWork func() error
	snapshots chan Snapshot
	once      sync.Once

	snapshotMu         sync.RWMutex
	latestSnapshot     Snapshot
	nextGeneration     uint64
	completionCompiler indexcompletion.Compiler
	promptTextCompiler indexprompttext.Compiler
}

// StartOwnIndexer starts the same devtools indexing service and filesystem
// watcher used by `crux dev`, without constructing an HTTP server.
func StartOwnIndexer(ctx context.Context, options OwnOptions) (OwnSource, error) {
	if options.Root == "" {
		return nil, fmt.Errorf("own Project Index requires a project root")
	}
	ownContext, cancel := context.WithCancel(ctx)
	state := store.NewStore()
	service := devtools.NewService(state, inspect.NewService(state, inspect.Dir("")))
	worker := assets.NewEmbeddedProjectIndexer("")
	service.WithProjectIndexer(worker)
	source := &ownIndexerSource{
		context: ownContext, cancel: cancel, devtools: service,
		closeWork: worker.Close, snapshots: make(chan Snapshot, 16),
		completionCompiler: worker, promptTextCompiler: worker,
	}
	fail := func(err error) (OwnSource, error) {
		source.Close()
		return nil, err
	}
	changes := service.SubscribeChanges()
	if err := privacy.InvalidateGenerated(options.Root); err != nil {
		return fail(fmt.Errorf("invalidate generated privacy policy: %w", err))
	}
	if _, err := service.ReindexProjectWithOptions(
		ownContext,
		options.Root,
		"",
		"",
		devtools.ProjectReindexOptions{Semantic: devtools.ProjectSemanticBackground},
	); err != nil {
		return fail(fmt.Errorf("initial own Project Index: %w", err))
	}
	if err := projectwatchhost.Start(ownContext, projectwatchhost.Options{
		Root: options.Root, Devtools: service,
	}); err != nil {
		return fail(fmt.Errorf("start own Project Index watcher: %w", err))
	}
	initial, err := ownSnapshot(ownContext, service)
	if err != nil {
		return fail(err)
	}
	source.snapshots <- source.stampSnapshot(initial)
	go source.run(changes)
	go func() {
		<-ownContext.Done()
		source.Close()
	}()
	return source, nil
}

func (s *ownIndexerSource) Snapshots() <-chan Snapshot { return s.snapshots }

func (s *ownIndexerSource) Close() {
	s.once.Do(func() {
		s.cancel()
		s.devtools.Shutdown()
		_ = s.closeWork()
	})
}

func (s *ownIndexerSource) run(changes <-chan struct{}) {
	defer close(s.snapshots)
	for {
		select {
		case <-s.context.Done():
			return
		case <-changes:
			snapshot, err := ownSnapshot(s.context, s.devtools)
			if err != nil {
				continue
			}
			snapshot = s.stampSnapshot(snapshot)
			select {
			case s.snapshots <- snapshot:
			case <-s.context.Done():
				return
			}
		}
	}
}

func (s *ownIndexerSource) Completion(ctx context.Context, request CompletionRequest) (CompletionResult, error) {
	s.snapshotMu.RLock()
	snapshot := s.latestSnapshot
	s.snapshotMu.RUnlock()
	return completeOwn(ctx, s.completionCompiler, snapshot, request)
}

func (s *ownIndexerSource) PromptText(
	ctx context.Context,
	request PromptTextRequest,
) (PromptTextResult, error) {
	return indexprompttext.New(s.promptTextCompiler).Analyze(ctx, request)
}

func (s *ownIndexerSource) stampSnapshot(snapshot Snapshot) Snapshot {
	s.snapshotMu.Lock()
	s.nextGeneration++
	generation := s.nextGeneration
	snapshot.Generation = &generation
	s.latestSnapshot = snapshot
	s.snapshotMu.Unlock()
	return snapshot
}

func ownSnapshot(ctx context.Context, service *devtools.Service) (Snapshot, error) {
	index, err := service.ProjectIndex(ctx)
	if err != nil {
		return Snapshot{}, fmt.Errorf("read own Project Index: %w", err)
	}
	return snapshotFromIndex(index), nil
}

func snapshotFromIndex(index api.IndexData) Snapshot {
	root := index.ProjectRoot
	if root == "" && index.Project != nil {
		root = index.Project.Root
	}
	return Snapshot{
		ProjectRoot: root,
		Indexing:    index.Indexing,
		Diagnostics: index.Diagnostics,
		Findings:    index.LintFindings,
		Definitions: index.Definitions,
		Relations:   index.Relations,
		Sources:     index.Sources,
	}
}
