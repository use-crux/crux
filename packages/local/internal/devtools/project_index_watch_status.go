package devtools

import (
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type projectIndexWatchStatusStore struct {
	mu     sync.Mutex
	status api.ProjectIndexWatchStatus
}

func (s *projectIndexWatchStatusStore) Snapshot() api.ProjectIndexWatchStatus {
	if s == nil {
		return api.ProjectIndexWatchStatus{State: "idle"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneProjectIndexWatchStatus(s.status)
}

func (s *projectIndexWatchStatusStore) Start(run ProjectWatchRunOptions, files []string, deletedFiles []string) {
	if s == nil || run.RunID == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = api.ProjectIndexWatchStatus{
		State: "running",
		LastRun: &api.ProjectIndexWatchRunInfo{
			RunID:                   run.RunID,
			Status:                  "running",
			ChangedFileCount:        len(files),
			DeletedFileCount:        len(deletedFiles),
			DeltaBatchCount:         run.DeltaBatchCount,
			CoalescedWhileRunning:   run.CoalescedWhileRunning,
			PendingRunReplacedCount: run.PendingRunReplacedCount,
			SemanticStatus:          "not-requested",
		},
	}
}

func (s *projectIndexWatchStatusStore) FullFallback(run ProjectWatchRunOptions, files []string, deletedFiles []string, reason string) {
	if s == nil || run.RunID == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = api.ProjectIndexWatchStatus{
		State: "fallback",
		LastRun: &api.ProjectIndexWatchRunInfo{
			RunID:                   run.RunID,
			Status:                  "fallback",
			PlanKind:                "full-reindex-required",
			FallbackUsed:            true,
			FallbackReason:          reason,
			ChangedFileCount:        len(files),
			DeletedFileCount:        len(deletedFiles),
			DeltaBatchCount:         run.DeltaBatchCount,
			CoalescedWhileRunning:   run.CoalescedWhileRunning,
			PendingRunReplacedCount: run.PendingRunReplacedCount,
			SemanticStatus:          "not-requested",
		},
	}
}

func (s *projectIndexWatchStatusStore) IncrementalResult(
	run ProjectWatchRunOptions,
	result ProjectIndexIncrementalResult,
	patchCount int,
	semanticStatus string,
) {
	if s == nil || run.RunID == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = api.ProjectIndexWatchStatus{
		State: "running",
		LastRun: &api.ProjectIndexWatchRunInfo{
			RunID:                   run.RunID,
			Status:                  "ast-ready",
			PlanKind:                result.Report.PlanKind,
			FallbackUsed:            result.Report.FallbackUsed,
			FallbackReason:          result.Report.FallbackReason,
			GraphConfidence:         result.Report.GraphConfidence,
			ChangedFileCount:        len(result.Report.ChangedFiles),
			DeletedFileCount:        len(result.Report.DeletedFiles),
			AffectedFileCount:       len(result.Report.AffectedFiles),
			AffectedDefinitionCount: len(result.Report.AffectedDefinitionIDs),
			PatchCount:              patchCount,
			DeltaBatchCount:         run.DeltaBatchCount,
			CoalescedWhileRunning:   run.CoalescedWhileRunning,
			PendingRunReplacedCount: run.PendingRunReplacedCount,
			PhaseTimingsMs:          cloneFloatMap(result.Report.DurationMsByPhase),
			SemanticStatus:          semanticStatus,
		},
	}
}

func (s *projectIndexWatchStatusStore) SemanticReady(runID uint64) {
	s.updateSemantic(runID, "idle", "semantic-ready", "ready", false)
}

func (s *projectIndexWatchStatusStore) SemanticDegraded(runID uint64) {
	s.updateSemantic(runID, "degraded", "semantic-degraded", "degraded", false)
}

func (s *projectIndexWatchStatusStore) SemanticDisabled(runID uint64) {
	s.updateSemantic(runID, "idle", "semantic-disabled", "disabled", false)
}

func (s *projectIndexWatchStatusStore) SemanticStaleDropped(runID uint64) {
	s.updateSemantic(runID, "idle", "semantic-stale-dropped", "stale-dropped", true)
}

func (s *projectIndexWatchStatusStore) updateSemantic(
	runID uint64,
	state string,
	status string,
	semanticStatus string,
	staleDropped bool,
) {
	if s == nil || runID == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status.LastRun == nil || s.status.LastRun.RunID != runID {
		return
	}
	nextRun := *s.status.LastRun
	nextRun.Status = status
	nextRun.SemanticStatus = semanticStatus
	nextRun.StaleSemanticDropped = staleDropped
	s.status.State = state
	s.status.LastRun = &nextRun
}

func cloneProjectIndexWatchStatus(status api.ProjectIndexWatchStatus) api.ProjectIndexWatchStatus {
	next := status
	if status.LastRun != nil {
		run := *status.LastRun
		run.PhaseTimingsMs = cloneFloatMap(status.LastRun.PhaseTimingsMs)
		next.LastRun = &run
	}
	if next.State == "" {
		next.State = "idle"
	}
	return next
}

func cloneFloatMap(values map[string]float64) map[string]float64 {
	if values == nil {
		return nil
	}
	next := make(map[string]float64, len(values))
	for key, value := range values {
		next[key] = value
	}
	return next
}
