package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/statichost"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticrun"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticsource"
)

type projectNativeStaticSkeletonResult struct {
	Prepare  staticprotocol.PrepareResponse
	Analyze  staticprotocol.AnalyzeResponse
	Finalize staticprotocol.FinalizeResponse
}

// runNativeStaticCompilerSkeleton exercises the planned Go-owned native static
// compiler lane without wiring it into production `nativeAst` indexing.
//
// The method deliberately requires StaticCompiler rather than the
// syntax-record parser interfaces. Tests use that split to prove the skeleton
// does not route through Node projection or StaticSyntaxFileRecord streaming.
func (w *Worker) runNativeStaticCompilerSkeleton(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []staticprotocol.SourceFile,
) (projectNativeStaticSkeletonResult, error) {
	if w == nil || w.syntaxParser == nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project native static compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project syntax parser does not implement native static compiler")
	}

	identity := staticprotocol.SkeletonIdentity()
	prepare, err := compiler.NativeStaticPrepare(ctx, staticprotocol.PrepareRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.PrepareMethod,
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		Identity:        identity,
		Files:           files,
	})
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static prepare: %w", err)
	}

	analyze, err := compiler.NativeStaticAnalyzeStream(ctx, staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Stream:          true,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           staticsource.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static analyze: %w", err)
	}

	finalize, err := compiler.NativeStaticFinalize(ctx, staticprotocol.FinalizeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static finalize: %w", err)
	}

	return projectNativeStaticSkeletonResult{
		Prepare:  prepare,
		Analyze:  analyze,
		Finalize: finalize,
	}, nil
}

func (w *Worker) indexProjectAstPatchFromNativeStaticCompiler(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan projectindex.ProjectStaticSyntaxPlan,
	compiler StaticCompiler,
) (projectindex.IndexPatch, ProjectIndexAstTiming, bool, error) {
	result, err := staticrun.Run(ctx, staticrun.Request{
		Root:         root,
		ConfigPath:   configPath,
		ProjectName:  projectName,
		Plan:         plan,
		Compiler:     compiler,
		PatchOptions: staticPatchOptions(root),
		Evidence: func(ctx context.Context, jobs []json.RawMessage) ([]json.RawMessage, error) {
			return statichost.ExtractEvidenceFacts(ctx, statichost.ArtifactReaderFunc(w.streamArtifact), root, configPath, projectName, jobs)
		},
	})
	if err != nil {
		return projectindex.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	timing := ProjectIndexAstTiming{
		NativeParseAndForwardMs: result.NativeParseAndForwardMs,
		NodeTimings:             result.NodeTimings,
	}
	if result.NodeReason != "" {
		timing = projectIndexAstTimingNodeRequired(timing, result.NodeReason)
	}
	return result.Patch, timing, result.Used, nil
}
