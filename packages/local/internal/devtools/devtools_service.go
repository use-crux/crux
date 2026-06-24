package devtools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/indexread"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type Service struct {
	ctx           context.Context
	cancel        context.CancelFunc
	store         *store.Store
	quality       *quality.Service
	observability *observability.Service
	resources     ResourceInspector
	indexEvents   *IndexEventBus
	indexer       projectindex.ProjectIndexer
	indexCache    *projectindex.Cache
	indexMu       sync.Mutex
	indexState    *projectindex.State
	watchStatus   projectIndexWatchStatusStore
	indexModel    *indexread.Model
}

func NewService(s *store.Store, qualitySvc *quality.Service) *Service {
	if qualitySvc == nil {
		qualitySvc = quality.NewService(s, quality.Dir(""))
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		ctx:         ctx,
		cancel:      cancel,
		store:       s,
		quality:     qualitySvc,
		indexEvents: NewIndexEventBus(),
		indexCache:  projectindex.NewCache(projectindex.NewSQLiteIndexFactStore()),
		indexState:  projectindex.NewState(),
		indexModel:  indexread.New(s, qualitySvc.Dir()),
	}
	service.startIndexChangePublisher()
	return service
}

func (s *Service) WithIndexModel(model *indexread.Model) *Service {
	s.indexModel = model
	return s
}

func (s *Service) WithObservability(service *observability.Service) *Service {
	s.observability = service
	if service != nil {
		s.quality.WithObservability(service)
	}
	return s
}

func (s *Service) WithResourceInspection(inspector ResourceInspector) *Service {
	s.resources = inspector
	return s
}

func (s *Service) WithProjectIndexer(indexer projectindex.ProjectIndexer) *Service {
	s.indexer = indexer
	return s
}

func (s *Service) WithFactStore(facts projectindex.FactStore) *Service {
	if s.indexCache == nil {
		s.indexCache = projectindex.NewCache(facts)
	} else {
		s.indexCache.SetFactStore(facts)
	}
	return s
}

func (s *Service) HasProjectIndexer() bool {
	return s.indexer != nil
}

func (s *Service) startIndexChangePublisher() {
	changes := s.store.Subscribe()
	go func() {
		var timer *time.Timer
		var timerC <-chan time.Time
		for {
			select {
			case <-s.ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case <-changes:
				if timer == nil {
					timer = time.NewTimer(100 * time.Millisecond)
					timerC = timer.C
					continue
				}
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(100 * time.Millisecond)
			case <-timerC:
				s.indexEvents.Publish(s.indexReadModel())
				timer = nil
				timerC = nil
			}
		}
	}()
}

func (s *Service) Shutdown() {
	s.cancel()
}

func (s *Service) Quality() *quality.Service {
	return s.quality
}

func (s *Service) IndexEvents() *IndexEventBus {
	return s.indexEvents
}

func (s *Service) SubscribeChanges() <-chan struct{} {
	return s.store.Subscribe()
}

func (s *Service) RegisterIndexSnapshot(_ context.Context, index store.IndexData) {
	s.store.SetIndexData(projectindex.MergeRuntimeSnapshot(s.store.GetIndex(), index))
	s.indexEvents.Publish(s.indexReadModel())
}

func (s *Service) ProjectIndex(_ context.Context) (api.IndexData, error) {
	var out api.IndexData
	return out, assignJSON(&out, s.indexReadModel())
}

func (s *Service) ProjectIndexWatchStatus(_ context.Context) (api.ProjectIndexWatchStatus, error) {
	return s.watchStatus.Snapshot(), nil
}

func (s *Service) ApplyIndexPatch(_ context.Context, patch projectindex.IndexPatch) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.applyIndexPatchLocked(patch)
}

func (s *Service) applyIndexPatchLocked(patch projectindex.IndexPatch) store.IndexData {
	applied := s.indexState.Apply(patch)
	s.store.SetIndexData(applied)
	index := s.indexReadModel()
	s.indexEvents.Publish(index)
	return index
}

func (s *Service) indexReadModel() store.IndexData {
	if s.indexModel != nil {
		return s.indexModel.Index()
	}
	return s.store.GetIndex()
}

func (s *Service) Context() api.DevtoolsContext {
	var ctx api.DevtoolsContext
	wd, _ := os.Getwd()
	ctx.Project.Path = wd
	ctx.Project.Name = filepath.Base(wd)
	ctx.Version = "dev"
	ctx.Git.Branch = strings.TrimSpace(runGit("branch", "--show-current"))
	sha := strings.TrimSpace(runGit("rev-parse", "--short=7", "HEAD"))
	ctx.Git.CommitSHA = sha
	ctx.Git.Dirty = strings.TrimSpace(runGit("status", "--porcelain")) != ""
	ctx.Target.Kind = "agent"
	return ctx
}

func runGit(args ...string) string {
	cmd := exec.Command("git", args...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(out)
}
