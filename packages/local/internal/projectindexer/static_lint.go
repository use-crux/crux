package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (w *Worker) IndexProjectLintPatch(ctx context.Context, request devtools.ProjectLintIndexRequest) (devtools.IndexPatch, error) {
	if w == nil || !request.ASTUsedNativeStatic {
		return devtools.IndexPatch{}, nil
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return devtools.IndexPatch{}, fmt.Errorf("native static lint finalize requires a native static compiler")
	}
	lintFacts, err := projectNativeStaticLintFacts(request.Root, request.ProjectName, request.PreviousIndex)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(lintFacts) == 0 {
		return devtools.IndexPatch{}, nil
	}
	lintConfig, err := projectNativeStaticLintConfig(request.PreviousIndex)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	ruleFacts, err := w.projectNativeStaticRuleFactsFromPrefetchOrRequest(ctx, request)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	finalize, err := compiler.NativeStaticFinalize(ctx, staticprotocol.FinalizeRequest{
		ProtocolVersion:  staticprotocol.Version,
		Method:           staticprotocol.FinalizeMethod,
		Identity:         projectNativeStaticSkeletonIdentity(),
		NativeFacts:      []json.RawMessage{},
		ExtensionFacts:   ruleFacts,
		LintFacts:        lintFacts,
		LintConfig:       lintConfig,
		LintFiles:        projectNativeStaticLintFiles(request.PreviousIndex),
		EmitBuiltinLints: nativeStaticBoolPtr(true),
		PatchPhase:       "quality",
	})
	if err != nil {
		return devtools.IndexPatch{}, fmt.Errorf("native static lint finalize: %w", err)
	}
	patch, _, usedNativeStatic, err := projectNativeStaticPatchFromFinalizeEvents(request.Root, finalize.Events)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if !usedNativeStatic {
		return devtools.IndexPatch{}, nil
	}
	return patch, nil
}

func (w *Worker) PrefetchProjectLintFacts(
	ctx context.Context,
	request devtools.ProjectLintIndexRequest,
) (devtools.ProjectLintPrefetchResult, error) {
	if w == nil || !request.ASTUsedNativeStatic {
		return devtools.ProjectLintPrefetchResult{}, nil
	}
	ruleFacts, err := w.projectNativeStaticPostMergeRuleFacts(ctx, request)
	if err != nil {
		return devtools.ProjectLintPrefetchResult{}, err
	}
	return devtools.ProjectLintPrefetchResult{RuleFacts: normalizedNativeStaticRuleFacts(ruleFacts)}, nil
}

func (w *Worker) projectNativeStaticRuleFactsFromPrefetchOrRequest(
	ctx context.Context,
	request devtools.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if request.Prefetch != nil {
		return normalizedNativeStaticRuleFacts(request.Prefetch.RuleFacts), nil
	}
	ruleFacts, err := w.projectNativeStaticPostMergeRuleFacts(ctx, request)
	if err != nil {
		return nil, err
	}
	return normalizedNativeStaticRuleFacts(ruleFacts), nil
}

func normalizedNativeStaticRuleFacts(ruleFacts []json.RawMessage) []json.RawMessage {
	if ruleFacts == nil {
		return []json.RawMessage{}
	}
	return ruleFacts
}

func (w *Worker) projectNativeStaticPostMergeRuleFacts(
	ctx context.Context,
	request devtools.ProjectLintIndexRequest,
) ([]json.RawMessage, error) {
	if !projectIndexRequiresTypeScriptRules(request.PreviousIndex) {
		return nil, nil
	}
	graphPatch := devtools.IndexPatch{
		Facts: devtools.IndexPatchFacts{
			Definitions: append([]store.ProjectDefinition(nil), request.PreviousIndex.Definitions...),
			Relations:   append([]store.ProjectRelation(nil), request.PreviousIndex.Relations...),
		},
	}
	return w.projectNativeStaticRuleFacts(
		ctx,
		request.Root,
		request.ConfigPath,
		request.ProjectName,
		graphPatch,
		projectNativeStaticLintFiles(request.PreviousIndex),
	)
}

func projectIndexRequiresTypeScriptRules(index store.IndexData) bool {
	for _, descriptor := range index.RuleDescriptors {
		if descriptor.Source == "extension" || descriptor.Extension != nil {
			return true
		}
	}
	return false
}

func projectNativeStaticLintFacts(root, projectName string, index store.IndexData) ([]json.RawMessage, error) {
	facts := []json.RawMessage{}
	if marker, err := json.Marshal(map[string]string{"root": root, "projectName": projectName}); err != nil {
		return nil, err
	} else {
		facts = append(facts, marker)
	}
	if len(index.Definitions) > 0 {
		if fact, ok, err := projectNativeStaticGroupedJSONFact("definitions", index.Definitions); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.Relations) > 0 {
		if fact, ok, err := projectNativeStaticGroupedJSONFact("relations", index.Relations); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.RuleDescriptors) > 0 {
		if fact, ok, err := projectNativeStaticGroupedJSONFact("ruleDescriptors", index.RuleDescriptors); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.Sources) > 0 {
		if fact, ok, err := projectNativeStaticGroupedJSONFact("sources", index.Sources); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if index.SourceGraph != nil {
		if fact, ok, err := projectNativeStaticGroupedJSONFact("sourceGraph", index.SourceGraph); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(facts) == 1 {
		return nil, nil
	}
	return facts, nil
}

func projectNativeStaticGroupedJSONFact(key string, value any) (json.RawMessage, bool, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, false, fmt.Errorf("marshal native static lint %s facts: %w", key, err)
	}
	return projectNativeStaticGroupedFact(key, raw)
}

func projectNativeStaticLintConfig(index store.IndexData) (json.RawMessage, error) {
	if index.Lint == nil {
		return nil, nil
	}
	data, err := json.Marshal(index.Lint)
	if err != nil {
		return nil, fmt.Errorf("marshal native static lint config: %w", err)
	}
	return data, nil
}

func projectNativeStaticLintFiles(index store.IndexData) []string {
	files := make([]string, 0, len(index.Sources)+len(index.Definitions))
	seen := map[string]bool{}
	add := func(file string) {
		if file == "" || seen[file] {
			return
		}
		seen[file] = true
		files = append(files, file)
	}
	for _, source := range index.Sources {
		add(source.File)
	}
	for _, definition := range index.Definitions {
		if definition.Source != nil {
			add(definition.Source.File)
		}
		for _, ref := range definition.SourceRefs {
			add(ref.Source.File)
		}
	}
	return files
}
