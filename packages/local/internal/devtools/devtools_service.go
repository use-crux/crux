package devtools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/readmodel"
	"github.com/use-crux/crux/packages/local/internal/projectindex/service"
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
	indexService  *service.Service
	indexModel    *readmodel.Model
}

func NewService(s *store.Store, qualitySvc *quality.Service) *Service {
	if qualitySvc == nil {
		qualitySvc = quality.NewService(s, quality.Dir(""))
	}
	ctx, cancel := context.WithCancel(context.Background())
	svc := &Service{
		ctx:         ctx,
		cancel:      cancel,
		store:       s,
		quality:     qualitySvc,
		indexEvents: NewIndexEventBus(),
		indexModel:  readmodel.New(s, qualitySvc.Dir()),
	}
	svc.indexService = service.New(service.Options{
		Context:   ctx,
		Store:     s,
		ReadModel: svc.indexReadModel,
		Publish:   svc.indexEvents.Publish,
	})
	svc.startIndexChangePublisher()
	return svc
}

func (s *Service) WithIndexModel(model *readmodel.Model) *Service {
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
	s.indexService.WithProjectIndexer(indexer)
	return s
}

func (s *Service) WithFactStore(facts service.CacheStore) *Service {
	s.indexService.WithFactStore(facts)
	return s
}

func (s *Service) HasProjectIndexer() bool {
	return s.indexService.HasProjectIndexer()
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
	return s.indexService.WatchStatus(), nil
}

func (s *Service) ApplyIndexPatch(ctx context.Context, patch projectindex.IndexPatch) store.IndexData {
	return s.indexService.ApplyIndexPatch(ctx, patch)
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
