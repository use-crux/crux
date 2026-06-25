package host

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
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

const (
	projectIndexNodeReasonTypeScriptStaticCompiler = "typescript-static-compiler"
	projectIndexNodeReasonStaticPlanInspection     = "static-plan-inspection"
	projectIndexNodeReasonStaticIndexConfig        = planner.ReasonConfig
	projectIndexNodeReasonStaticIndexExtensions    = planner.ReasonExtensions
	projectIndexNodeReasonSyntaxRecordProjection   = "syntax-record-projection"
	projectIndexNodeReasonStaticIndexEmpty         = compiler.ReasonEmpty
	projectIndexNodeReasonStaticIndexEvidence      = compiler.ReasonEvidence
	projectIndexNodeReasonStaticIndexRules         = "static-index-rules"
	projectIndexNodeReasonStaticIndexIncomplete    = compiler.ReasonIncomplete
)
