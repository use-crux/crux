package run

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/evidence"
	runlint "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/lint"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax/record"
)

const (
	ReasonEmpty      = "static-index-empty-finalize"
	ReasonEvidence   = "static-index-extension-evidence"
	ReasonIncomplete = "static-index-incomplete"
)

type Compiler interface {
	StaticIndexPrepare(context.Context, protocol.PrepareRequest) (protocol.PrepareResponse, error)
	StaticIndexAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error)
	StaticIndexFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error)
}

type EvidenceFunc func(context.Context, []json.RawMessage) ([]json.RawMessage, error)

type Request struct {
	Root         string
	ConfigPath   string
	ProjectName  string
	Plan         projectindex.ProjectStaticSyntaxPlan
	Compiler     Compiler
	Evidence     EvidenceFunc
	PatchOptions patch.Options
}

type Result struct {
	Patch projectindex.IndexPatch
	Timing
	Used bool
}

type Timing struct {
	NativeParseAndForwardMs float64
	NodeTimings             []projectindex.ProjectIndexPhaseTiming
	NodeReason              string
}

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

	analyzeFiles, err := analyzeFiles(request.Plan, prepare.Plan, sourceInput)
	if err != nil {
		return Result{}, err
	}
	if compileStreamer, ok := request.Compiler.(patch.CompileStreamer); ok && compat.NativeOnlyEligible(request.Plan) {
		return runCompile(ctx, request, identity, started, prepare.Plan, analyzeFiles, sourceInput, compileStreamer)
	}

	analyze, err := evidence.Analyze(
		ctx,
		request.Compiler,
		protocol.AnalyzeRequest{
			ProtocolVersion:            protocol.Version,
			Method:                     protocol.AnalyzeMethod,
			Identity:                   identity,
			Plan:                       prepare.Plan,
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

	replayedFacts, err := cache.ReplayFacts(request.Root, request.ProjectName, prepare.Plan.CacheHits)
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
	})
	if err != nil {
		return Result{}, fmt.Errorf("Static Index finalize: %w", err)
	}
	if !used {
		timing.NodeReason = incompleteReason(timings)
		return Result{Timing: timing}, nil
	}
	finishPatch(&patch, request.Plan, sourceInput)
	writeCache(request, sourceInput, prepare.Plan, patch)
	timing.NodeTimings = timings
	return Result{Patch: patch, Timing: timing, Used: true}, nil
}

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
		LintSuppressions: runlint.SuppressionsFromSourceText(sourceInput.SourceTextByFile),
		EmitBuiltinLints: &emitBuiltinLints,
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

func prepareRequest(request Request, identity protocol.RunIdentity, sourceInput sourceprofile.Input) protocol.PrepareRequest {
	return protocol.PrepareRequest{
		ProtocolVersion:          protocol.Version,
		Method:                   protocol.PrepareMethod,
		Root:                     request.Root,
		ConfigPath:               request.ConfigPath,
		ProjectName:              request.ProjectName,
		Identity:                 identity,
		Files:                    sourceInput.Files,
		PrimaryFiles:             sourceInput.PrimaryFiles,
		CallNames:                append([]string(nil), request.Plan.CallNames...),
		CallInterests:            record.CallInterests(request.Plan.CallInterests),
		ConstructorNames:         append([]string(nil), request.Plan.ConstructorNames...),
		ConstructorInterests:     record.ConstructorInterests(request.Plan.ConstructorInterests),
		PruneNativeFactCallNames: append([]string(nil), request.Plan.PruneNativeFactCallNames...),
		CacheInputs:              append([]json.RawMessage(nil), request.Plan.CacheInputs...),
		ExtensionHost:            request.Plan.StaticHost,
	}
}

func analyzeFiles(
	plan projectindex.ProjectStaticSyntaxPlan,
	preparePlan protocol.Plan,
	sourceInput sourceprofile.Input,
) ([]protocol.AnalyzeFile, error) {
	sourceFiles := sourceprofile.FilesToAnalyze(preparePlan.CacheMisses, record.Files(plan))
	return sourceprofile.AnalyzeFilesWithSourceText(sourceFiles, sourceInput.SourceTextByFile)
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

func writeCache(
	request Request,
	sourceInput sourceprofile.Input,
	preparePlan protocol.Plan,
	patch projectindex.IndexPatch,
) {
	if !cache.StatusEnabledFromEnv() {
		return
	}
	cache.WriteFromPatch(
		request.Root,
		request.Plan.CacheInputs,
		cache.SourceInput{
			Files:                 sourceInput.Files,
			SemanticSourceProfile: sourceInput.SemanticSourceProfile,
		},
		preparePlan,
		patch,
	)
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
