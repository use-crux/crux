package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/statichost"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticlint"
)

func (w *Worker) IndexProjectLintPatch(ctx context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	if w == nil || !request.ASTUsedNativeStatic {
		return projectindex.IndexPatch{}, nil
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectindex.IndexPatch{}, fmt.Errorf("native static lint finalize requires a native static compiler")
	}
	ruleFacts, err := w.staticLintRuleFacts(ctx, request)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	patch, usedNativeStatic, err := staticlint.FinalizePatch(ctx, compiler, staticlint.FinalizeOptions{
		Root:         request.Root,
		ProjectName:  request.ProjectName,
		Index:        request.PreviousIndex,
		RuleFacts:    ruleFacts,
		PatchOptions: staticPatchOptions(request.Root),
	})
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if !usedNativeStatic {
		return projectindex.IndexPatch{}, nil
	}
	return patch, nil
}

func (w *Worker) PrefetchProjectLintFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) (projectindex.ProjectLintPrefetchResult, error) {
	if w == nil || !request.ASTUsedNativeStatic {
		return projectindex.ProjectLintPrefetchResult{}, nil
	}
	ruleFacts, err := w.postMergeRuleFacts(ctx, request)
	if err != nil {
		return projectindex.ProjectLintPrefetchResult{}, err
	}
	return projectindex.ProjectLintPrefetchResult{RuleFacts: staticlint.NormalizeRuleFacts(ruleFacts)}, nil
}

func (w *Worker) staticLintRuleFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if request.Prefetch != nil {
		return staticlint.NormalizeRuleFacts(request.Prefetch.RuleFacts), nil
	}
	ruleFacts, err := w.postMergeRuleFacts(ctx, request)
	if err != nil {
		return nil, err
	}
	return staticlint.NormalizeRuleFacts(ruleFacts), nil
}

func (w *Worker) postMergeRuleFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if !staticlint.RequiresTypeScriptRules(request.PreviousIndex) {
		return nil, nil
	}
	return statichost.CheckRuleFacts(
		ctx,
		statichost.ArtifactReaderFunc(w.streamArtifact),
		request.Root,
		request.ConfigPath,
		request.ProjectName,
		staticlint.GraphPatch(request.PreviousIndex),
		staticlint.Files(request.PreviousIndex),
	)
}
