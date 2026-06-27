package run

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

const (
	ReasonEmpty      = "static-index-empty-finalize"
	ReasonEvidence   = "static-index-extension-evidence"
	ReasonIncomplete = "static-index-incomplete"
)

// Compiler is the narrow Go view of the Rust Static Index compiler methods the
// run pipeline drives. The concrete implementation lives in the
// staticindex/compiler package.
type Compiler interface {
	StaticIndexPrepare(context.Context, protocol.PrepareRequest) (protocol.PrepareResponse, error)
	StaticIndexAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error)
	StaticIndexFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

// EvidenceFunc fetches TypeScript extension evidence for the analyze phase.
type EvidenceFunc func(context.Context, []json.RawMessage) ([]json.RawMessage, error)

// Request describes one Static Index execution over a planned project.
type Request struct {
	Root         string
	ConfigPath   string
	ProjectName  string
	Plan         projectindex.ProjectStaticSyntaxPlan
	Compiler     Compiler
	Evidence     EvidenceFunc
	PatchOptions patch.Options
}

// Result is the outcome of a Static Index execution.
type Result struct {
	Patch projectindex.IndexPatch
	Timing
	Used bool
}

// Timing records the native-vs-node phase timing observed during a run.
type Timing struct {
	NativeParseAndForwardMs float64
	NodeTimings             []projectindex.ProjectIndexPhaseTiming
	NodeReason              string
}

// Run is the deep-module entry point for a single source-only Static Index
// attempt. It prepares the compiler plan, decides between the native compile
// lane and the analyze/finalize lane, and returns the resulting patch plus
// timing. All lower-level prepare/analyze/finalize/compile/cache concerns live
// in sibling files in this package.
func Run(ctx context.Context, request Request) (Result, error) {
	started := time.Now()
	sourceInput, err := sourceprofile.FromPlan(request.Plan)
	if err != nil {
		return Result{}, err
	}

	identity := protocol.SkeletonIdentity()
	prepare, err := request.Compiler.StaticIndexPrepare(ctx, prepareRequest(request, identity, sourceInput))
	if err != nil {
		return Result{}, fmt.Errorf("Static Index prepare: %w", err)
	}

	files, err := analyzeFiles(request.Plan, prepare.Plan, sourceInput)
	if err != nil {
		return Result{}, err
	}

	if compileStreamer, ok := request.Compiler.(patch.CompileStreamer); ok && compat.NativeOnlyEligible(request.Plan) {
		return runCompile(ctx, request, identity, started, prepare.Plan, files, sourceInput, compileStreamer)
	}

	return runFinalize(ctx, request, identity, started, prepare.Plan, files, sourceInput)
}

func finishPatch(
	patch *projectindex.IndexPatch,
	plan projectindex.ProjectStaticSyntaxPlan,
	sourceInput sourceprofile.Input,
) {
	if sourceInput.SemanticSourceProfile != nil {
		patch.SemanticSourceProfile = sourceprofile.RequestProfile(sourceInput.SemanticSourceProfile, plan.Files)
	}
}

func incompleteReason(timings []projectindex.ProjectIndexPhaseTiming) string {
	if len(timings) == 0 {
		return ReasonEmpty
	}
	return ReasonIncomplete
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
