package run

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

// runCompile executes the native compile lane: a single compile stream replaces
// the analyze + finalize round-trip when the compiler exposes a CompileStreamer
// and the plan is native-only eligible.
func runCompile(
	ctx context.Context,
	request Request,
	identity protocol.RunIdentity,
	started time.Time,
	preparePlan protocol.Plan,
	analyzeFiles []protocol.AnalyzeFile,
	sourceInput sourceprofile.Input,
	compiler patch.CompileStreamer,
) (Result, error) {
	extensionFacts, err := compat.FinalizerFacts(request.Plan)
	if err != nil {
		return Result{}, err
	}
	replayedFacts, err := cache.ReplayFacts(request.Root, request.ProjectName, preparePlan.CacheHits)
	if err != nil {
		return Result{}, err
	}
	emitBuiltinLints := false
	patch, timings, used, _, err := patch.FromCompileStream(ctx, request.PatchOptions, compiler, protocol.CompileRequest{
		ProtocolVersion:  protocol.Version,
		Method:           protocol.CompileMethod,
		Identity:         identity,
		Plan:             preparePlan,
		Files:            analyzeFiles,
		NativeFacts:      replayedFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    request.Plan.RelationSpecs,
		LintConfig:       request.Plan.LintConfig,
		EmitBuiltinLints: &emitBuiltinLints,
		PatchInvalidates: request.PatchInvalidates,
	})
	timing := Timing{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		return Result{}, fmt.Errorf("Static Index compile: %w", err)
	}
	if !used {
		timing.NodeReason = incompleteReason(timings)
		return Result{Timing: timing}, nil
	}
	finishPatch(&patch, request.Plan, sourceInput)
	writeCache(request, sourceInput, preparePlan, patch)
	timing.NodeTimings = timings
	return Result{Patch: patch, Timing: timing, Used: true}, nil
}
