package server

import "github.com/use-crux/crux/packages/local/internal/devtools"

// ProjectIndexAstTiming captures production AST pipeline timings for benchmark
// and architecture work. It is diagnostic metadata only; it is not part of the
// Project Index read model.
type ProjectIndexAstTiming struct {
	PlanMs                  float64
	NativeParseAndForwardMs float64
	NodeProjectionMs        float64
	TotalMs                 float64
	NodeTimings             []devtools.ProjectIndexPhaseTiming
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
	projectIndexNodeReasonNativeStaticConfig       = "native-static-config"
	projectIndexNodeReasonNativeStaticExtensions   = "native-static-extensions"
	projectIndexNodeReasonSyntaxRecordProjection   = "syntax-record-projection"
	projectIndexNodeReasonNativeStaticEmpty        = "native-static-empty-finalize"
	projectIndexNodeReasonNativeStaticEvidence     = "native-static-extension-evidence"
	projectIndexNodeReasonNativeStaticRules        = "native-static-rules"
	projectIndexNodeReasonNativeStaticIncomplete   = "native-static-incomplete"
)
