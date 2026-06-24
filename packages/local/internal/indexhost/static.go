package indexhost

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/protocol"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/sourceprofile"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcompile"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcompile/host"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type projectNativeStaticSkeletonResult struct {
	Prepare  protocol.PrepareResponse
	Analyze  protocol.AnalyzeResponse
	Finalize protocol.FinalizeResponse
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
	files []protocol.SourceFile,
) (projectNativeStaticSkeletonResult, error) {
	if w == nil || w.syntaxParser == nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project native static compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project syntax parser does not implement native static compiler")
	}

	identity := protocol.SkeletonIdentity()
	prepare, err := compiler.NativeStaticPrepare(ctx, protocol.PrepareRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		Identity:        identity,
		Files:           files,
	})
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static prepare: %w", err)
	}

	analyze, err := compiler.NativeStaticAnalyzeStream(ctx, protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Stream:          true,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           sourceprofile.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static analyze: %w", err)
	}

	finalize, err := compiler.NativeStaticFinalize(ctx, protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
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
	result, err := staticcompile.Run(ctx, staticcompile.Request{
		Root:         root,
		ConfigPath:   configPath,
		ProjectName:  projectName,
		Plan:         plan,
		Compiler:     compiler,
		PatchOptions: staticPatchOptions(root),
		Evidence: func(ctx context.Context, jobs []json.RawMessage) ([]json.RawMessage, error) {
			return host.ExtractEvidenceFacts(ctx, host.ArtifactReaderFunc(w.streamArtifact), root, configPath, projectName, jobs)
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
