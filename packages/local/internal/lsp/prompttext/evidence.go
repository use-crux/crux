package prompttext

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"slices"

	"github.com/use-crux/crux/packages/local/internal/api"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type semanticFragmentJoin struct {
	Kind                string          `json:"kind"`
	OwnerSourceRefID    string          `json:"ownerSourceRefId"`
	OwnerTemplateRange  api.SourceRange `json:"ownerTemplateRange"`
	InterpolationIndex  uint32          `json:"interpolationIndex"`
	ExpressionRange     api.SourceRange `json:"expressionRange"`
	TargetSourceRefID   string          `json:"targetSourceRefId"`
	TargetTemplateRange api.SourceRange `json:"targetTemplateRange"`
	Proof               string          `json:"proof"`
}

type semanticRef struct {
	sourceRef api.ProjectSourceRef
	file      string
	hash      string
	source    staticprotocol.PromptTextRange
	joins     []semanticFragmentJoin
}

// semanticPreviewEvidence translates compiler-produced semantic facts into
// bounded worker evidence. It never evaluates TypeScript: invalid, ambiguous,
// stale, or disconnected facts are omitted rather than repaired.
func semanticPreviewEvidence(
	publication readmodel.Publication,
	root string,
	documentFile string,
	documentText string,
) ([]indexprompttext.Fragment, []indexprompttext.FragmentJoin) {
	documentFile = filepath.Clean(resolveFile(root, documentFile))
	documentHash, ok := sourceHashForFile(publication, root, documentFile)
	if !ok || documentHash != sha256String(documentText) {
		return []indexprompttext.Fragment{}, []indexprompttext.FragmentJoin{}
	}

	fragmentsByID := make(map[string]indexprompttext.Fragment)
	joins := make([]indexprompttext.FragmentJoin, 0)
	for _, definition := range publication.DefinitionsByID {
		fragments, definitionJoins := definitionPreviewEvidence(
			publication, definition, root, documentFile, documentText,
		)
		for _, fragment := range fragments {
			if _, duplicate := fragmentsByID[fragment.ID]; duplicate {
				return []indexprompttext.Fragment{}, []indexprompttext.FragmentJoin{}
			}
			fragmentsByID[fragment.ID] = fragment
		}
		joins = append(joins, definitionJoins...)
	}

	fragments := make([]indexprompttext.Fragment, 0, len(fragmentsByID))
	for _, fragment := range fragmentsByID {
		fragments = append(fragments, fragment)
	}
	slices.SortFunc(fragments, func(left, right indexprompttext.Fragment) int {
		return bytes.Compare([]byte(left.ID), []byte(right.ID))
	})
	slices.SortFunc(joins, compareWorkerJoin)
	return fragments, joins
}

func definitionPreviewEvidence(
	publication readmodel.Publication,
	definition api.ProjectDefinition,
	root, documentFile, documentText string,
) ([]indexprompttext.Fragment, []indexprompttext.FragmentJoin) {
	refs := make(map[string]semanticRef, len(definition.SourceRefs))
	seenIDs := make(map[string]struct{}, len(definition.SourceRefs))
	for _, sourceRef := range definition.SourceRefs {
		if sourceRef.ID != "" {
			if _, duplicate := seenIDs[sourceRef.ID]; duplicate {
				return nil, nil
			}
			seenIDs[sourceRef.ID] = struct{}{}
		}
		ref, ok := semanticPromptTextRef(publication, root, sourceRef)
		if !ok {
			continue
		}
		refs[sourceRef.ID] = ref
	}

	active := make([]string, 0)
	for id, ref := range refs {
		if ref.file != documentFile {
			continue
		}
		if _, _, _, ok := exactSourceRange(ref.sourceRef.Snippet.Range, documentText); !ok {
			continue
		}
		if _, ok := canonicalSourceRefRange(
			ref.sourceRef, root, documentFile, documentText,
		); ok {
			active = append(active, id)
		}
	}
	slices.Sort(active)

	joinGraph := noncyclicSemanticJoins(refs)
	fragments := make(map[string]indexprompttext.Fragment)
	joins := make([]indexprompttext.FragmentJoin, 0)
	visited := make(map[string]struct{})
	for len(active) > 0 {
		ownerID := active[0]
		active = active[1:]
		if _, seen := visited[ownerID]; seen {
			continue
		}
		visited[ownerID] = struct{}{}
		owner := refs[ownerID]
		for _, join := range joinGraph[ownerID] {
			target, ok := refs[join.TargetSourceRefID]
			if !ok {
				continue
			}
			fragments[target.sourceRef.ID] = indexprompttext.Fragment{
				ID: target.sourceRef.ID, Symbol: target.sourceRef.Symbol,
				File: target.file, SourceHash: target.hash, Range: target.source,
				Snippet: target.sourceRef.Snippet.Source,
			}
			joins = append(joins, indexprompttext.FragmentJoin{
				Key: staticprotocol.PromptTextInterpolationJoinKey{
					File: owner.file, SourceHash: owner.hash,
					TemplateRange:   owner.source,
					Interpolation:   join.InterpolationIndex,
					ExpressionRange: sourceProtocolRange(join.ExpressionRange),
				},
				FragmentID: target.sourceRef.ID,
				Proof:      staticprotocol.PromptTextProofSemanticExact,
			})
			active = append(active, target.sourceRef.ID)
		}
	}
	result := make([]indexprompttext.Fragment, 0, len(fragments))
	for _, fragment := range fragments {
		result = append(result, fragment)
	}
	return result, joins
}

func semanticPromptTextRef(
	publication readmodel.Publication,
	root string,
	sourceRef api.ProjectSourceRef,
) (semanticRef, bool) {
	if sourceRef.ID == "" || sourceRef.Fidelity != "resolved" || sourceRef.Snippet == nil ||
		sourceRef.Snippet.Truncated || !staticMarkdownSourceRef(sourceRef) ||
		!sameFile(root, sourceRef.Source.File, sourceRef.Snippet.Range.File) {
		return semanticRef{}, false
	}
	source, ok := exactSnippetRange(sourceRef.Snippet.Range, sourceRef.Snippet.Source)
	if !ok {
		return semanticRef{}, false
	}
	file := filepath.Clean(resolveFile(root, sourceRef.Snippet.Range.File))
	hash, ok := sourceHashForFile(publication, root, file)
	if !ok {
		return semanticRef{}, false
	}
	joins, ok := semanticJoins(sourceRef.Metadata)
	if !ok {
		return semanticRef{}, false
	}
	return semanticRef{
		sourceRef: sourceRef, file: file, hash: hash, source: source, joins: joins,
	}, true
}

func semanticJoins(metadata map[string]any) ([]semanticFragmentJoin, bool) {
	promptText, ok := metadata["promptText"].(map[string]any)
	if !ok {
		return nil, false
	}
	value, exists := promptText["fragmentJoins"]
	if !exists {
		return []semanticFragmentJoin{}, true
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var joins []semanticFragmentJoin
	if err := decoder.Decode(&joins); err != nil || joins == nil {
		return nil, false
	}
	return joins, true
}

func uniqueSemanticJoins(joins []semanticFragmentJoin) []semanticFragmentJoin {
	counts := make(map[string]int, len(joins))
	for _, join := range joins {
		counts[semanticJoinOccurrence(join)]++
	}
	result := make([]semanticFragmentJoin, 0, len(joins))
	for _, join := range joins {
		if counts[semanticJoinOccurrence(join)] == 1 {
			result = append(result, join)
		}
	}
	return result
}

func validSemanticJoin(
	owner, target semanticRef,
	join semanticFragmentJoin,
) bool {
	targetKind, targetKindOK := staticMarkdownSourceKind(target.sourceRef)
	return join.Kind == "named-fragment" && join.Proof == "semantic-exact" &&
		join.OwnerSourceRefID == owner.sourceRef.ID &&
		join.TargetSourceRefID == target.sourceRef.ID &&
		targetKindOK && targetKind == promptview.PromptTextSourceNamedFragment &&
		staticMarkdownSourceRef(owner.sourceRef) &&
		staticMarkdownSourceRef(target.sourceRef) &&
		joinContextMatches(owner.sourceRef, target.sourceRef) &&
		sourceRangesEqual(join.OwnerTemplateRange, owner.sourceRef.Snippet.Range) &&
		sourceRangesEqual(join.TargetTemplateRange, target.sourceRef.Snippet.Range) &&
		sourceRangeWithin(join.ExpressionRange, join.OwnerTemplateRange)
}

func joinContextMatches(owner, target api.ProjectSourceRef) bool {
	return owner.Role == target.Role && owner.Property == target.Property &&
		promptTextLifecycle(owner.Metadata) == promptTextLifecycle(target.Metadata)
}

func promptTextLifecycle(metadata map[string]any) string {
	promptText, ok := metadata["promptText"].(map[string]any)
	if !ok {
		return ""
	}
	lifecycle, _ := promptText["lifecycle"].(string)
	return lifecycle
}

func semanticJoinOccurrence(join semanticFragmentJoin) string {
	data, _ := json.Marshal(struct {
		Owner string
		Index uint32
		Range api.SourceRange
	}{join.OwnerSourceRefID, join.InterpolationIndex, join.ExpressionRange})
	return string(data)
}
