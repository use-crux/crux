package staticrun

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticcache"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticevidence"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/statichost"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticpatch"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticsource"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntaxrecord"
)

const (
	ReasonEmpty      = "native-static-empty-finalize"
	ReasonEvidence   = "native-static-extension-evidence"
	ReasonIncomplete = "native-static-incomplete"
)

type Compiler interface {
	NativeStaticPrepare(context.Context, staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error)
	NativeStaticAnalyzeStream(context.Context, staticprotocol.AnalyzeRequest, staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error)
	NativeStaticFinalizeStream(context.Context, staticprotocol.FinalizeRequest, staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error)
}

type EvidenceFunc func(context.Context, []json.RawMessage) ([]json.RawMessage, error)

type Request struct {
	Root         string
	ConfigPath   string
	ProjectName  string
	Plan         projectindex.ProjectStaticSyntaxPlan
	Compiler     Compiler
	Evidence     EvidenceFunc
	PatchOptions staticpatch.Options
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
	sourceInput, err := staticsource.FromPlan(request.Plan)
	if err != nil {
		return Result{}, err
	}

	identity := staticprotocol.SkeletonIdentity()
	prepare, err := request.Compiler.NativeStaticPrepare(ctx, prepareRequest(request, identity, sourceInput))
	if err != nil {
		return Result{}, fmt.Errorf("native static prepare: %w", err)
	}

	analyzeFiles, err := analyzeFiles(request.Plan, prepare.Plan, sourceInput)
	if err != nil {
		return Result{}, err
	}
	if compileStreamer, ok := request.Compiler.(staticpatch.CompileStreamer); ok && statichost.NativeOnlyEligible(request.Plan) {
		return runCompile(ctx, request, identity, started, prepare.Plan, analyzeFiles, sourceInput, compileStreamer)
	}

	analyze, err := staticevidence.Analyze(
		ctx,
		request.Compiler,
		staticprotocol.AnalyzeRequest{
			ProtocolVersion:            staticprotocol.Version,
			Method:                     staticprotocol.AnalyzeMethod,
			Identity:                   identity,
			Plan:                       prepare.Plan,
			Files:                      analyzeFiles,
			ExtensionEvidenceInterests: request.Plan.StaticInterests,
		},
		staticevidence.FetchFunc(request.Evidence),
	)
	timing := Timing{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		if analyze.NodeStarted {
			timing.NodeReason = ReasonEvidence
			return Result{Timing: timing}, nil
		}
		return Result{}, fmt.Errorf("native static analyze: %w", err)
	}

	extensionFacts, err := statichost.FinalizerFacts(request.Plan)
	if err != nil {
		return Result{}, err
	}
	if analyze.NodeStarted {
		timing.NodeReason = ReasonEvidence
	}
	extensionFacts = append(extensionFacts, analyze.Facts...)

	replayedFacts, err := staticcache.ReplayFacts(request.Root, request.ProjectName, prepare.Plan.CacheHits)
	if err != nil {
		return Result{}, err
	}
	nativeFacts := append(replayedFacts, analyze.Analyze.Facts...)
	emitBuiltinLints := false
	patch, timings, used, _, err := staticpatch.FromFinalizeStream(ctx, request.PatchOptions, request.Compiler, staticprotocol.FinalizeRequest{
		ProtocolVersion:  staticprotocol.Version,
		Method:           staticprotocol.FinalizeMethod,
		Identity:         identity,
		NativeFacts:      nativeFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    request.Plan.RelationSpecs,
		LintConfig:       request.Plan.LintConfig,
		LintFiles:        append([]string(nil), request.Plan.Files...),
		EmitBuiltinLints: &emitBuiltinLints,
	})
	if err != nil {
		return Result{}, fmt.Errorf("native static finalize: %w", err)
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
	identity staticprotocol.RunIdentity,
	started time.Time,
	preparePlan staticprotocol.Plan,
	analyzeFiles []staticprotocol.AnalyzeFile,
	sourceInput staticsource.Input,
	compiler staticpatch.CompileStreamer,
) (Result, error) {
	extensionFacts, err := statichost.FinalizerFacts(request.Plan)
	if err != nil {
		return Result{}, err
	}
	replayedFacts, err := staticcache.ReplayFacts(request.Root, request.ProjectName, preparePlan.CacheHits)
	if err != nil {
		return Result{}, err
	}
	emitBuiltinLints := false
	patch, timings, used, _, err := staticpatch.FromCompileStream(ctx, request.PatchOptions, compiler, staticprotocol.CompileRequest{
		ProtocolVersion:  staticprotocol.Version,
		Method:           staticprotocol.CompileMethod,
		Identity:         identity,
		Plan:             preparePlan,
		Files:            analyzeFiles,
		NativeFacts:      replayedFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    request.Plan.RelationSpecs,
		LintConfig:       request.Plan.LintConfig,
		LintFiles:        append([]string(nil), request.Plan.Files...),
		EmitBuiltinLints: &emitBuiltinLints,
	})
	timing := Timing{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		return Result{}, fmt.Errorf("native static compile: %w", err)
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

func prepareRequest(request Request, identity staticprotocol.RunIdentity, sourceInput staticsource.Input) staticprotocol.PrepareRequest {
	return staticprotocol.PrepareRequest{
		ProtocolVersion:          staticprotocol.Version,
		Method:                   staticprotocol.PrepareMethod,
		Root:                     request.Root,
		ConfigPath:               request.ConfigPath,
		ProjectName:              request.ProjectName,
		Identity:                 identity,
		Files:                    sourceInput.Files,
		PrimaryFiles:             sourceInput.PrimaryFiles,
		CallNames:                append([]string(nil), request.Plan.CallNames...),
		CallInterests:            syntaxrecord.CallInterests(request.Plan.CallInterests),
		ConstructorNames:         append([]string(nil), request.Plan.ConstructorNames...),
		ConstructorInterests:     syntaxrecord.ConstructorInterests(request.Plan.ConstructorInterests),
		PruneNativeFactCallNames: append([]string(nil), request.Plan.PruneNativeFactCallNames...),
		CacheInputs:              append([]json.RawMessage(nil), request.Plan.CacheInputs...),
		ExtensionHost:            request.Plan.StaticHost,
	}
}

func analyzeFiles(
	plan projectindex.ProjectStaticSyntaxPlan,
	preparePlan staticprotocol.Plan,
	sourceInput staticsource.Input,
) ([]staticprotocol.AnalyzeFile, error) {
	sourceFiles := staticsource.FilesToAnalyze(preparePlan.CacheMisses, syntaxrecord.Files(plan))
	return staticsource.AnalyzeFilesWithSourceText(sourceFiles, sourceInput.SourceTextByFile)
}

func finishPatch(
	patch *projectindex.IndexPatch,
	plan projectindex.ProjectStaticSyntaxPlan,
	sourceInput staticsource.Input,
) {
	if sourceInput.SemanticSourceProfile != nil {
		patch.SemanticSourceProfile = staticsource.RequestProfile(sourceInput.SemanticSourceProfile, plan.Files)
	}
}

func writeCache(
	request Request,
	sourceInput staticsource.Input,
	preparePlan staticprotocol.Plan,
	patch projectindex.IndexPatch,
) {
	if !staticcache.StatusEnabledFromEnv() {
		return
	}
	staticcache.WriteFromPatch(
		request.Root,
		request.Plan.CacheInputs,
		staticcache.SourceInput{
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
