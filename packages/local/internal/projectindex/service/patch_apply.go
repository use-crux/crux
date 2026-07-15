package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ApplyIndexPatch applies a phase patch and publishes the resulting snapshot.
func (s *Service) ApplyIndexPatch(ctx context.Context, patch projectindex.IndexPatch) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.applyIndexPatchLocked(ctx, patch)
}

// RegisterRuntimeSnapshot records Core's startup snapshot without changing
// compiler phase ownership. The snapshot participates in published projections
// and in validation of subsequent owner-scoped runtime updates.
func (s *Service) RegisterRuntimeSnapshot(ctx context.Context, snapshot store.IndexData) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	registered := store.IndexData{}
	if s.runtimeSnapshot != nil {
		registered = *s.runtimeSnapshot
	}
	registered = projectindex.MergeRuntimeSnapshot(registered, snapshot)
	s.runtimeSnapshot = &registered
	if s.authoritativeASTObserved {
		s.retireRegisteredMCPServers(s.indexState.Index())
	}
	projected := s.runtimeOverlays.Project(s.registeredBaseLocked())
	s.store.SetIndexData(projected)
	index := s.indexReadModel()
	s.publishIndex(index)
	return index
}

func (s *Service) applyIndexPatchLocked(ctx context.Context, patch projectindex.IndexPatch) store.IndexData {
	if s.shouldPreserveIncompleteASTPatchLocked(patch) {
		s.indexState.AdvanceASTGeneration()
		base := projectIncompleteASTHealth(s.indexState.Index(), patch)
		applied := s.runtimeOverlays.Project(s.projectRegisteredSnapshotLocked(base))
		s.store.SetIndexData(applied)
		index := s.indexReadModel()
		s.publishIndex(index)
		return index
	}
	compilerBase := s.indexState.Apply(patch)
	// Reconcile against the authoritative compiler lane, not the registered
	// startup snapshot. A successful AST omission removes an authored MCP owner;
	// failed or partial reindexes never enter this path.
	s.reconcileRuntimeOverlays(ctx, patch, compilerBase)
	base := s.projectRegisteredSnapshotLocked(compilerBase)
	applied := s.runtimeOverlays.Project(base)
	s.store.SetIndexData(applied)
	index := s.indexReadModel()
	s.publishIndex(index)
	return index
}

func (s *Service) reconcileRuntimeOverlays(
	ctx context.Context,
	patch projectindex.IndexPatch,
	base store.IndexData,
) {
	if patch.Phase != projectindex.PhaseAST ||
		(patch.Status != "" && patch.Status != "ok") ||
		projectindex.IsSourceOnlyIndex(base) {
		return
	}
	s.authoritativeASTObserved = true
	s.retireRegisteredMCPServers(base)
	changed, removed := s.runtimeOverlays.ReconcileAuthoritativeBase(base)
	root := patch.Project.Root
	for _, overlay := range changed {
		_ = s.indexCache.CommitRuntimeOverlay(ctx, root, overlay)
	}
	for _, ownerID := range removed {
		_ = s.indexCache.DeleteRuntimeOverlay(ctx, root, ownerID)
	}
}

// ApplyRuntimeUpdate atomically replaces one definition owner's runtime
// contribution and publishes the newly projected Project Index snapshot.
func (s *Service) ApplyRuntimeUpdate(ctx context.Context, update projectindex.ProjectIndexRuntimeUpdate) (store.IndexData, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	base := s.registeredBaseLocked()
	if err := projectindex.ValidateRuntimeUpdateAgainstBase(base, update); err != nil {
		return store.IndexData{}, projectindex.NewRuntimeUpdateValidationError(err)
	}
	previous, existed := s.runtimeOverlays.Overlay(update.Owner.DefinitionID)
	if update.Operation == projectindex.RuntimeUpdateReplace {
		if conflict := s.runtimeOverlays.FindConflict(base, update); conflict != nil {
			s.runtimeOverlays.ApplyConflict(update, conflict)
			s.runtimeOverlays.SetOwnerFingerprint(
				update.Owner.DefinitionID,
				ownerFingerprint(base, update.Owner.DefinitionID),
			)
			if err := s.persistRuntimeOverlay(ctx, update.Owner.DefinitionID); err != nil {
				s.runtimeOverlays.Restore(update.Owner.DefinitionID, previous, existed)
				return store.IndexData{}, projectindex.NewRuntimeUpdatePersistenceError(err)
			}
			projected := s.runtimeOverlays.Project(base)
			s.store.SetIndexData(projected)
			index := s.indexReadModel()
			s.publishIndex(index)
			return index, conflict
		}
	}
	if err := s.runtimeOverlays.Apply(update); err != nil {
		return store.IndexData{}, projectindex.NewRuntimeUpdateValidationError(err)
	}
	s.runtimeOverlays.SetOwnerFingerprint(
		update.Owner.DefinitionID,
		ownerFingerprint(base, update.Owner.DefinitionID),
	)
	if err := s.persistRuntimeOverlay(ctx, update.Owner.DefinitionID); err != nil {
		s.runtimeOverlays.Restore(update.Owner.DefinitionID, previous, existed)
		return store.IndexData{}, projectindex.NewRuntimeUpdatePersistenceError(err)
	}
	projected := s.runtimeOverlays.Project(base)
	s.store.SetIndexData(projected)
	index := s.indexReadModel()
	s.publishIndex(index)
	return index, nil
}

func ownerFingerprint(index store.IndexData, ownerDefinitionID string) string {
	for _, definition := range index.Definitions {
		if definition.ID == ownerDefinitionID {
			return definition.Fingerprint
		}
	}
	return ""
}

func (s *Service) persistRuntimeOverlay(ctx context.Context, ownerDefinitionID string) error {
	overlay, ok := s.runtimeOverlays.Overlay(ownerDefinitionID)
	if !ok {
		return nil
	}
	root := ""
	if project := s.registeredBaseLocked().Project; project != nil {
		root = project.Root
	}
	if root != "" {
		return s.indexCache.CommitRuntimeOverlay(ctx, root, overlay)
	}
	return fmt.Errorf("runtime overlay project root is empty")
}

func (s *Service) hydrateRuntimeOverlays(ctx context.Context, root string) error {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.runtimeOverlays.IsEmpty() {
		return nil
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	overlays, err := s.indexCache.LoadRuntimeOverlays(ctx, root)
	if err != nil {
		return err
	}
	s.runtimeOverlays.Hydrate(overlays, true)
	return nil
}

// commitAndApply persists a patch to the warm-start cache, then applies and
// publishes it. It is the single write path shared by the full and incremental
// reindex flows.
func (s *Service) commitAndApply(ctx context.Context, patch projectindex.IndexPatch) (store.IndexData, error) {
	if !s.shouldPreserveIncompleteASTPatch(patch) {
		if err := s.indexCache.Commit(ctx, patch); err != nil {
			return store.IndexData{}, err
		}
	}
	return s.ApplyIndexPatch(ctx, patch), nil
}

func isIncompleteASTPatch(patch projectindex.IndexPatch) bool {
	return patch.Phase == projectindex.PhaseAST &&
		(patch.Status == "" || patch.Status == "ok") &&
		projectindex.HasSourceOnlyDiagnostic(patch.Facts.Diagnostics)
}

func (s *Service) shouldPreserveIncompleteASTPatch(patch projectindex.IndexPatch) bool {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.shouldPreserveIncompleteASTPatchLocked(patch)
}

func (s *Service) shouldPreserveIncompleteASTPatchLocked(patch projectindex.IndexPatch) bool {
	return isIncompleteASTPatch(patch) &&
		(s.authoritativeASTObserved || !projectindex.IsEmptyIndex(s.indexState.Index()))
}

func projectIncompleteASTHealth(base store.IndexData, patch projectindex.IndexPatch) store.IndexData {
	if patch.Indexing != nil {
		base.Indexing = patch.Indexing
	}
	diagnostics := append([]store.IndexDiagnostic(nil), base.Diagnostics...)
	seen := map[string]bool{}
	for _, diagnostic := range diagnostics {
		seen[diagnostic.ID] = true
	}
	for _, diagnostic := range patch.Facts.Diagnostics {
		if !seen[diagnostic.ID] {
			diagnostics = append(diagnostics, diagnostic)
		}
	}
	base.Diagnostics = diagnostics
	return base
}

// commitAndApplyRaw persists a patch and updates the raw store without running
// synchronous devtools read-model enrichment. Watch refreshes use this so the
// AST-ready path is not blocked by quality/local enrichment; the store mutation
// still wakes the debounced publisher owned by the devtools service.
func (s *Service) commitAndApplyRaw(ctx context.Context, patch projectindex.IndexPatch) (store.IndexData, error) {
	preserveIncomplete := s.shouldPreserveIncompleteASTPatch(patch)
	if !preserveIncomplete {
		if err := s.indexCache.Commit(ctx, patch); err != nil {
			return store.IndexData{}, err
		}
	}
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if preserveIncomplete {
		s.indexState.AdvanceASTGeneration()
		base := projectIncompleteASTHealth(s.indexState.Index(), patch)
		applied := s.runtimeOverlays.Project(s.projectRegisteredSnapshotLocked(base))
		s.store.SetIndexData(applied)
		return applied, nil
	}
	compilerBase := s.indexState.Apply(patch)
	// Keep authoritative authored-owner removal independent from startup
	// snapshot enrichment on the raw watch-refresh path as well.
	s.reconcileRuntimeOverlays(ctx, patch, compilerBase)
	base := s.projectRegisteredSnapshotLocked(compilerBase)
	applied := s.runtimeOverlays.Project(base)
	s.store.SetIndexData(applied)
	return applied, nil
}

// normalizePatchIdentity fills in the project identity and finish timestamp that
// every applied patch must carry when a phase client leaves them empty.
func normalizePatchIdentity(
	patch projectindex.IndexPatch,
	root string,
	configPath string,
	projectName string,
) projectindex.IndexPatch {
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return patch
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
