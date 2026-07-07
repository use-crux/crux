package run

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/evidence"
	runlint "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/lint"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

// runFinalize executes the analyze + finalize lane: it fetches extension
// evidence, replays cached facts, and streams the finalize phase into a patch.
// It is the default lane when the compiler does not support the native compile
// stream or the plan is not native-only eligible.
func runFinalize(
	ctx context.Context,
	request Request,
	identity protocol.RunIdentity,
	started time.Time,
	preparePlan protocol.Plan,
	analyzeFiles []protocol.AnalyzeFile,
	sourceInput sourceprofile.Input,
) (Result, error) {
	analyze, err := evidence.Analyze(
		ctx,
		request.Compiler,
		protocol.AnalyzeRequest{
			ProtocolVersion:            protocol.Version,
			Method:                     protocol.AnalyzeMethod,
			Identity:                   identity,
			Plan:                       preparePlan,
			Files:                      analyzeFiles,
			ExtensionEvidenceInterests: request.Plan.StaticInterests,
		},
		evidence.FetchFunc(request.Evidence),
	)
	timing := Timing{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		if analyze.NodeStarted {
			timing.NodeReason = ReasonEvidence
			return Result{Timing: timing}, nil
		}
		return Result{}, fmt.Errorf("Static Index analyze: %w", err)
	}

	extensionFacts, err := compat.FinalizerFacts(request.Plan)
	if err != nil {
		return Result{}, err
	}
	if analyze.NodeStarted {
		timing.NodeReason = ReasonEvidence
	}
	extensionFacts = append(extensionFacts, analyze.Facts...)

	replayedFacts, err := cache.ReplayFacts(request.Root, request.ProjectName, preparePlan.CacheHits)
	if err != nil {
		return Result{}, err
	}
	nativeFacts := append(replayedFacts, analyze.Analyze.Facts...)
	emitBuiltinLints := false
	patch, timings, used, _, err := patch.FromFinalizeStream(ctx, request.PatchOptions, request.Compiler, protocol.FinalizeRequest{
		ProtocolVersion:  protocol.Version,
		Method:           protocol.FinalizeMethod,
		Identity:         identity,
		NativeFacts:      nativeFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    request.Plan.RelationSpecs,
		LintConfig:       request.Plan.LintConfig,
		LintSuppressions: runlint.SuppressionsFromSourceText(sourceInput.SourceTextByFile),
		EmitBuiltinLints: &emitBuiltinLints,
		PatchInvalidates: request.PatchInvalidates,
	})
	if err != nil {
		return Result{}, fmt.Errorf("Static Index finalize: %w", err)
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
