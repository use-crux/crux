package host

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler/lint"
)

func (w *Worker) IndexProjectLintPatch(ctx context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	if w == nil || !request.ASTUsedStaticIndex {
		return projectindex.IndexPatch{}, nil
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectindex.IndexPatch{}, fmt.Errorf("Static Index lint finalize requires a Static Index compiler")
	}
	ruleFacts, err := w.staticLintRuleFacts(ctx, request)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	patch, usedStaticIndex, err := lint.FinalizePatch(ctx, compiler, lint.FinalizeOptions{
		Root:         request.Root,
		ProjectName:  request.ProjectName,
		Index:        request.PreviousIndex,
		RuleFacts:    ruleFacts,
		PatchOptions: staticPatchOptions(request.Root),
	})
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if !usedStaticIndex {
		return projectindex.IndexPatch{}, nil
	}
	return patch, nil
}

func (w *Worker) PrefetchProjectLintFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) (projectindex.ProjectLintPrefetchResult, error) {
	if w == nil || !request.ASTUsedStaticIndex {
		return projectindex.ProjectLintPrefetchResult{}, nil
	}
	ruleFacts, err := w.postMergeRuleFacts(ctx, request)
	if err != nil {
		return projectindex.ProjectLintPrefetchResult{}, err
	}
	return projectindex.ProjectLintPrefetchResult{RuleFacts: lint.NormalizeRuleFacts(ruleFacts)}, nil
}

func (w *Worker) staticLintRuleFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if request.Prefetch != nil {
		return lint.NormalizeRuleFacts(request.Prefetch.RuleFacts), nil
	}
	ruleFacts, err := w.postMergeRuleFacts(ctx, request)
	if err != nil {
		return nil, err
	}
	return lint.NormalizeRuleFacts(ruleFacts), nil
}

func (w *Worker) postMergeRuleFacts(
	ctx context.Context,
	request projectindex.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if !lint.RequiresTypeScriptRules(request.PreviousIndex) {
		return nil, nil
	}
	return compat.CheckRuleFacts(
		ctx,
		compat.ArtifactReaderFunc(w.streamArtifact),
		request.Root,
		request.ConfigPath,
		request.ProjectName,
		lint.GraphPatch(request.PreviousIndex),
		lint.Files(request.PreviousIndex),
	)
}
