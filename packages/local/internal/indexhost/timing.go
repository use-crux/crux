package indexhost

import (
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcompile"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticplan/plan"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
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
	projectIndexNodeReasonNativeStaticConfig       = staticplan.ReasonConfig
	projectIndexNodeReasonNativeStaticExtensions   = staticplan.ReasonExtensions
	projectIndexNodeReasonSyntaxRecordProjection   = "syntax-record-projection"
	projectIndexNodeReasonNativeStaticEmpty        = staticcompile.ReasonEmpty
	projectIndexNodeReasonNativeStaticEvidence     = staticcompile.ReasonEvidence
	projectIndexNodeReasonNativeStaticRules        = "native-static-rules"
	projectIndexNodeReasonNativeStaticIncomplete   = staticcompile.ReasonIncomplete
)
