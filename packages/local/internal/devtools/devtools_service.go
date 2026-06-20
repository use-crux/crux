package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/indexread"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectIndexer owns source discovery for the Project Index.
type ProjectIndexer interface {
	IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (IndexPatch, error)
}

// ProjectSemanticIndexRequest describes one semantic Project Index enrichment
// request after AST/source indexing has selected the relevant project scope.
type ProjectSemanticIndexRequest struct {
	Root              string
	ConfigPath        string
	ProjectName       string
	IndexGeneration   uint64
	WatchRunID        uint64
	Budget            IndexPatchBudget
	PreviousIndex     *store.IndexData
	Files             []string
	DependencyClosure []string
	SourceProfile     *SemanticSourceProfile
}

type ProjectSemanticIndexer interface {
	IndexProjectSemanticPatch(ctx context.Context, req ProjectSemanticIndexRequest) (IndexPatch, error)
}

// ProjectRuntimeIndexRequest describes an explicit runtime-rich indexing pass.
// It receives the already-applied source/semantic snapshot as immutable input
// and must return only runtime-phase evidence.
type ProjectRuntimeIndexRequest struct {
	Root          string
	ConfigPath    string
	ProjectName   string
	Budget        IndexPatchBudget
	PreviousIndex store.IndexData
}

// ProjectRuntimeIndexer owns explicit runtime-rich evidence collection.
type ProjectRuntimeIndexer interface {
	IndexProjectRuntimePatch(ctx context.Context, req ProjectRuntimeIndexRequest) (IndexPatch, error)
}

type ProjectIncrementalIndexer interface {
	IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (ProjectIndexIncrementalResult, error)
}

type ResourceInspector interface {
	List(context.Context, resourceinspection.ListRequest) (resourceinspection.ResourceResult, error)
}

type Service struct {
	ctx             context.Context
	cancel          context.CancelFunc
	store           *store.Store
	quality         *quality.Service
	observability   *observability.Service
	resources       ResourceInspector
	indexEvents     *IndexEventBus
	indexer         ProjectIndexer
	factStore       FactStore
	indexMu         sync.Mutex
	indexPatch      indexPatchState
	indexGeneration projectIndexGeneration
	watchStatus     projectIndexWatchStatusStore
	indexModel      *indexread.Model
}

const defaultProjectIndexReindexTimeout = 120 * time.Second

var projectIndexSemanticTimeout = 30 * time.Second
var projectIndexRuntimeTimeout = 30 * time.Second

var projectIndexSemanticBudget = IndexPatchBudget{
	MaxFiles:        5000,
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxSources:      10000,
	MaxBytes:        8 * 1024 * 1024,
}

var projectIndexRuntimeBudget = IndexPatchBudget{
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxBytes:        8 * 1024 * 1024,
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
		factStore:   NewSQLiteIndexFactStore(),
		indexPatch:  emptyIndexPatchState(),
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

func (s *Service) WithProjectIndexer(indexer ProjectIndexer) *Service {
	s.indexer = indexer
	return s
}

func (s *Service) WithFactStore(facts FactStore) *Service {
	s.factStore = facts
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
	s.store.SetIndexData(mergeRuntimeIndexSnapshot(s.store.GetIndex(), index))
	s.indexEvents.Publish(s.indexReadModel())
}

func (s *Service) ProjectIndex(_ context.Context) (api.IndexData, error) {
	var out api.IndexData
	return out, assignJSON(&out, s.indexReadModel())
}

func (s *Service) ProjectIndexWatchStatus(_ context.Context) (api.ProjectIndexWatchStatus, error) {
	return s.watchStatus.Snapshot(), nil
}

func (s *Service) ApplyIndexPatch(_ context.Context, patch IndexPatch) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.applyIndexPatchLocked(patch)
}

func (s *Service) applyIndexPatchLocked(patch IndexPatch) store.IndexData {
	if patch.Phase == indexPatchPhaseAST {
		s.indexGeneration.BumpAST()
	}
	s.indexPatch = applyIndexPatch(s.indexPatch, patch)
	s.store.SetIndexData(s.indexPatch.Index)
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

func mustMarshalJSON(value any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return data
}

func mergeRuntimeIndexSnapshot(current, incoming store.IndexData) store.IndexData {
	if isEmptyIndex(current) {
		incoming.Diagnostics = filterRuntimeIndexDiagnostics(incoming.Diagnostics)
		return normalizeRuntimeIndexSnapshot(incoming)
	}

	merged := current
	merged.Prompts = mergePromptMeta(current.Prompts, incoming.Prompts)
	merged.Contexts = mergeContextMeta(current.Contexts, incoming.Contexts)
	merged.Tools = mergeToolMeta(current.Tools, incoming.Tools)
	merged.Definitions = mergeProjectDefinitions(current.Definitions, incoming.Definitions)
	merged.Relations = mergeProjectRelations(current.Relations, incoming.Relations)
	merged.Sources = mergeIndexSources(current.Sources, incoming.Sources)
	merged.Diagnostics = mergeIndexDiagnostics(current.Diagnostics, filterRuntimeIndexDiagnostics(incoming.Diagnostics))
	merged.LintFindings = mergeIndexLintFindings(current.LintFindings, incoming.LintFindings)
	if incoming.Lint != nil {
		merged.Lint = incoming.Lint
	}
	if incoming.SchemaVersion != 0 {
		merged.SchemaVersion = incoming.SchemaVersion
	}
	if incoming.Indexing != nil {
		merged.Indexing = incoming.Indexing
	}
	if incoming.SourceGraph != nil {
		merged.SourceGraph = incoming.SourceGraph
	}
	return normalizeRuntimeIndexSnapshot(merged)
}

func normalizeRuntimeIndexSnapshot(index store.IndexData) store.IndexData {
	index.Prompts = mergePromptMeta(nil, index.Prompts)
	index.Contexts = mergeContextMeta(nil, index.Contexts)
	index.Tools = mergeToolMeta(nil, index.Tools)
	index.Definitions = mergeProjectDefinitions(nil, index.Definitions)
	index.Relations = mergeProjectRelations(nil, index.Relations)
	index.Sources = mergeIndexSources(nil, index.Sources)
	index.Diagnostics = mergeIndexDiagnostics(nil, index.Diagnostics)
	index.LintFindings = mergeIndexLintFindings(nil, index.LintFindings)
	return index
}

func isEmptyIndex(index store.IndexData) bool {
	return len(index.Prompts) == 0 &&
		len(index.Contexts) == 0 &&
		len(index.Tools) == 0 &&
		len(index.Definitions) == 0 &&
		len(index.Relations) == 0 &&
		len(index.Diagnostics) == 0 &&
		len(index.LintFindings) == 0 &&
		len(index.Sources) == 0
}

func isSourceOnlyIndex(index store.IndexData) bool {
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code == "index.source_only" {
			return true
		}
	}
	return false
}

func hasSourceOnlyDiagnostic(diagnostics []store.IndexDiagnostic) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "index.source_only" {
			return true
		}
	}
	return false
}

func hasOnlySourceOnlyDiagnostics(diagnostics []store.IndexDiagnostic) bool {
	if len(diagnostics) == 0 {
		return false
	}
	for _, diagnostic := range diagnostics {
		if diagnostic.Code != "index.source_only" {
			return false
		}
	}
	return true
}

func hasResolvedDefinitions(index store.IndexData) bool {
	for _, definition := range index.Definitions {
		if definition.Fidelity == "resolved" {
			return true
		}
	}
	return false
}

func filterRuntimeIndexDiagnostics(diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
	filtered := make([]store.IndexDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "index.source_only" {
			continue
		}
		filtered = append(filtered, diagnostic)
	}
	return filtered
}

func mergePromptMeta(current, incoming []store.PromptMeta) []store.PromptMeta {
	merged := make([]store.PromptMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeContextMeta(current, incoming []store.ContextMeta) []store.ContextMeta {
	merged := make([]store.ContextMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeToolMeta(current, incoming []store.ToolMeta) []store.ToolMeta {
	merged := make([]store.ToolMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.Name]; ok {
			merged[existing] = item
			continue
		}
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeProjectDefinitions(current, incoming []store.ProjectDefinition) []store.ProjectDefinition {
	merged := make([]store.ProjectDefinition, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = mergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = mergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeProjectDefinition(existing, incoming store.ProjectDefinition) store.ProjectDefinition {
	if fidelityRank(existing.Fidelity) > fidelityRank(incoming.Fidelity) {
		incoming.Fidelity = existing.Fidelity
	}
	if incoming.Status == "" {
		incoming.Status = existing.Status
	}
	if incoming.Source == nil {
		incoming.Source = existing.Source
	}
	if incoming.SourceSnippet == nil {
		incoming.SourceSnippet = existing.SourceSnippet
	}
	if len(incoming.SourceRefs) == 0 {
		incoming.SourceRefs = existing.SourceRefs
	}
	if incoming.Description == "" {
		incoming.Description = existing.Description
	}
	if len(incoming.Tags) == 0 {
		incoming.Tags = existing.Tags
	}
	if len(incoming.Path) == 0 {
		incoming.Path = existing.Path
	}
	if incoming.Fingerprint == "" {
		incoming.Fingerprint = existing.Fingerprint
	}
	if incoming.Metadata == nil {
		incoming.Metadata = existing.Metadata
	} else if existing.Metadata != nil {
		incoming.Metadata = mergeMetadataRaw(existing.Metadata, incoming.Metadata)
	}
	if incoming.Quality == nil {
		incoming.Quality = existing.Quality
	}
	return incoming
}

func fidelityRank(fidelity string) int {
	switch fidelity {
	case "resolved":
		return 3
	case "partial":
		return 2
	case "error":
		return 1
	default:
		return 0
	}
}

func mergeMetadataRaw(existing, incoming json.RawMessage) json.RawMessage {
	var existingMap map[string]any
	var incomingMap map[string]any
	if err := json.Unmarshal(existing, &existingMap); err != nil || existingMap == nil {
		return incoming
	}
	if err := json.Unmarshal(incoming, &incomingMap); err != nil || incomingMap == nil {
		return incoming
	}
	merged := map[string]any{}
	for key, value := range existingMap {
		merged[key] = value
	}
	for key, value := range incomingMap {
		merged[key] = value
	}
	merged = mergeDefinitionFactsMetadata(existingMap, incomingMap, merged)
	data, err := json.Marshal(merged)
	if err != nil {
		return incoming
	}
	return data
}

func mergeDefinitionFactsMetadata(existingMap, incomingMap, merged map[string]any) map[string]any {
	existingFacts, existingOK := existingMap["facts"].(map[string]any)
	incomingFacts, incomingOK := incomingMap["facts"].(map[string]any)
	if !existingOK && !incomingOK {
		return merged
	}
	facts := map[string]any{}
	for key, value := range existingFacts {
		facts[key] = value
	}
	for key, value := range incomingFacts {
		facts[key] = value
	}
	useEntries := appendJSONLists(existingFacts["useEntries"], incomingFacts["useEntries"])
	if len(useEntries) > 0 {
		facts["useEntries"] = useEntries
	}
	merged["facts"] = facts
	return merged
}

func appendJSONLists(existing, incoming any) []any {
	out := []any{}
	if list, ok := existing.([]any); ok {
		out = append(out, list...)
	}
	if list, ok := incoming.([]any); ok {
		out = append(out, list...)
	}
	return dedupeJSONList(out)
}

func dedupeJSONList(items []any) []any {
	seen := map[string]bool{}
	out := make([]any, 0, len(items))
	for _, item := range items {
		data, err := json.Marshal(item)
		key := string(data)
		if err != nil {
			key = fmt.Sprintf("%#v", item)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func mergeProjectRelations(current, incoming []store.ProjectRelation) []store.ProjectRelation {
	merged := make([]store.ProjectRelation, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		key := relationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		key := relationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexSources(current, incoming []store.IndexSourceFile) []store.IndexSourceFile {
	merged := make([]store.IndexSourceFile, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.File]; ok {
			merged[existing] = item
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexDiagnostics(current, incoming []store.IndexDiagnostic) []store.IndexDiagnostic {
	merged := make([]store.IndexDiagnostic, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if item.Code == "index.source_only" {
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if item.Code == "index.source_only" {
			continue
		}
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexLintFindings(current, incoming []store.IndexLintFinding) []store.IndexLintFinding {
	merged := make([]store.IndexLintFinding, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
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
