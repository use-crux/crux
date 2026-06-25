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
	UsedNativeStatic        bool
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
	projectIndexNodeReasonNativeStaticConfig       = planner.ReasonConfig
	projectIndexNodeReasonNativeStaticExtensions   = planner.ReasonExtensions
	projectIndexNodeReasonSyntaxRecordProjection   = "syntax-record-projection"
	projectIndexNodeReasonNativeStaticEmpty        = compiler.ReasonEmpty
	projectIndexNodeReasonNativeStaticEvidence     = compiler.ReasonEvidence
	projectIndexNodeReasonNativeStaticRules        = "native-static-rules"
	projectIndexNodeReasonNativeStaticIncomplete   = compiler.ReasonIncomplete
)
