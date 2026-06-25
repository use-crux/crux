package host

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	staticrun "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

type projectStaticIndexSkeletonResult struct {
	Prepare  protocol.PrepareResponse
	Analyze  protocol.AnalyzeResponse
	Finalize protocol.FinalizeResponse
}

// runStaticIndexCompilerSkeleton exercises the planned Go-owned Static Index
// compiler lane without wiring it into production `nativeAst` indexing.
//
// The method deliberately requires StaticCompiler rather than the
// syntax-record parser interfaces. Tests use that split to prove the skeleton
// does not route through Node projection or StaticSyntaxFileRecord streaming.
func (w *Bundle) runStaticIndexCompilerSkeleton(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []protocol.SourceFile,
) (projectStaticIndexSkeletonResult, error) {
	if w == nil || w.syntaxParser == nil {
		return projectStaticIndexSkeletonResult{}, fmt.Errorf("project Static Index compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectStaticIndexSkeletonResult{}, fmt.Errorf("project syntax parser does not implement Static Index compiler")
	}

	identity := protocol.SkeletonIdentity()
	prepare, err := compiler.StaticIndexPrepare(ctx, protocol.PrepareRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		Identity:        identity,
		Files:           files,
	})
	if err != nil {
		return projectStaticIndexSkeletonResult{}, fmt.Errorf("Static Index prepare: %w", err)
	}

	analyze, err := compiler.StaticIndexAnalyzeStream(ctx, protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Stream:          true,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           sourceprofile.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		return projectStaticIndexSkeletonResult{}, fmt.Errorf("Static Index analyze: %w", err)
	}

	finalize, err := compiler.StaticIndexFinalize(ctx, protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		return projectStaticIndexSkeletonResult{}, fmt.Errorf("Static Index finalize: %w", err)
	}

	return projectStaticIndexSkeletonResult{
		Prepare:  prepare,
		Analyze:  analyze,
		Finalize: finalize,
	}, nil
}

func (w *Bundle) indexProjectAstPatchFromStaticIndexCompiler(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan projectindex.ProjectStaticSyntaxPlan,
	staticCompiler StaticCompiler,
) (projectindex.IndexPatch, ProjectIndexAstTiming, bool, error) {
	result, err := staticrun.Run(ctx, staticrun.Request{
		Root:         root,
		ConfigPath:   configPath,
		ProjectName:  projectName,
		Plan:         plan,
		Compiler:     staticCompiler,
		PatchOptions: staticPatchOptions(root),
		Evidence: func(ctx context.Context, jobs []json.RawMessage) ([]json.RawMessage, error) {
			return compat.ExtractEvidenceFacts(ctx, compat.ArtifactReaderFunc(w.streamArtifact), root, configPath, projectName, jobs)
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
