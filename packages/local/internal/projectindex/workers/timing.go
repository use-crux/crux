package workers

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
)

// ProjectIndexAstTiming captures production AST pipeline timings for benchmark
// and architecture work. It is diagnostic metadata only; it is not part of the
// Project Index read model.
type ProjectIndexAstTiming struct {
	PlanMs                  float64
	NativeParseAndForwardMs float64
	NodeProjectionMs        float64
	TotalMs                 float64
	NodeTimings             []projectindex.ProjectIndexPhaseTiming
	NodeStarted             bool
	UsedStaticIndex         bool
	NodeReasons             []string
	NativeOnlyEligible      bool
	NativeOnlyReasons       []string
	RecordCount             int
	RecordBytes             int
	ChunkCount              int
	MaxChunkBytes           int
}

// LastAstTiming returns timing metadata from the most recent AST index run.
func (w *Bundle) LastAstTiming() ProjectIndexAstTiming {
	if w == nil {
		return ProjectIndexAstTiming{}
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	return w.lastAstTiming
}

// LastSemanticTimings returns diagnostic timing buckets from the latest semantic request.
func (w *Bundle) LastSemanticTimings() []projectindex.ProjectIndexPhaseTiming {
	if w == nil || w.semanticWorker == nil {
		return nil
	}
	return w.semanticWorker.LastSemanticTimings()
}

func (w *Bundle) recordLastAstTiming(timing ProjectIndexAstTiming) {
	if w == nil {
		return
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	w.lastAstTiming = timing
}

func (w *Bundle) recordLastAstTimingNodeRequired(reasons ...string) {
	if w == nil {
		return
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	w.lastAstTiming = projectIndexAstTimingNodeRequired(w.lastAstTiming, reasons...)
}

const (
	projectIndexNodeReasonTypeScriptStaticCompiler = "typescript-static-compiler"
	projectIndexNodeReasonStaticPlanInspection     = "static-plan-inspection"
	projectIndexNodeReasonStaticIndexConfig        = planner.ReasonConfig
	projectIndexNodeReasonStaticIndexExtensions    = planner.ReasonExtensions
	projectIndexNodeReasonSyntaxRecordProjection   = "syntax-record-projection"
	projectIndexNodeReasonStaticIndexEmpty         = session.ReasonEmpty
	projectIndexNodeReasonStaticIndexEvidence      = session.ReasonEvidence
	projectIndexNodeReasonStaticIndexRules         = "static-index-rules"
	projectIndexNodeReasonStaticIndexIncomplete    = session.ReasonIncomplete

	projectIndexNativeOnlyReasonStaticIndexCompilerSetup = "static-index-compiler-setup"
)

func projectIndexAstTimingNodeRequired(timing ProjectIndexAstTiming, reasons ...string) ProjectIndexAstTiming {
	if len(reasons) == 0 {
		return timing
	}
	timing.NodeStarted = true
	timing.NativeOnlyEligible = false
	timing.NodeReasons = appendUniqueStrings(timing.NodeReasons, reasons...)
	timing.NativeOnlyReasons = appendUniqueStrings(timing.NativeOnlyReasons, reasons...)
	return timing
}

func projectIndexAstTimingNativeOnlyBlocked(timing ProjectIndexAstTiming, reasons ...string) ProjectIndexAstTiming {
	if len(reasons) == 0 {
		return timing
	}
	timing.NativeOnlyEligible = false
	timing.NativeOnlyReasons = appendUniqueStrings(timing.NativeOnlyReasons, reasons...)
	return timing
}

func appendUniqueStrings(values []string, next ...string) []string {
	for _, value := range next {
		if value == "" || stringSliceContains(values, value) {
			continue
		}
		values = append(values, value)
	}
	return values
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
