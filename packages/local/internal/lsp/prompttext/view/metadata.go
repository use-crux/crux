package view

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type promptTextMetadata struct {
	Tag           string               `json:"tag"`
	Language      string               `json:"language"`
	Lifecycle     string               `json:"lifecycle"`
	SourceKind    PromptTextSourceKind `json:"sourceKind"`
	FragmentJoins json.RawMessage      `json:"fragmentJoins"`
}

type fragmentJoinMetadata struct {
	Kind                string          `json:"kind"`
	OwnerSourceRefID    string          `json:"ownerSourceRefId"`
	OwnerTemplateRange  api.SourceRange `json:"ownerTemplateRange"`
	InterpolationIndex  uint32          `json:"interpolationIndex"`
	ExpressionRange     api.SourceRange `json:"expressionRange"`
	TargetSourceRefID   string          `json:"targetSourceRefId"`
	TargetTemplateRange api.SourceRange `json:"targetTemplateRange"`
	Proof               string          `json:"proof"`
}

type refactorMetadata struct {
	Kind      string          `json:"kind"`
	Proof     string          `json:"proof"`
	Lifecycle string          `json:"lifecycle"`
	Target    string          `json:"target"`
	Binding   RefactorBinding `json:"binding"`
}

func normalizeSourceRefs(
	definition api.ProjectDefinition,
	root string,
) ([]PromptTextSourceRef, []FragmentJoin, []StringRefactorTarget) {
	refs := make([]PromptTextSourceRef, 0)
	refactors := make([]StringRefactorTarget, 0)
	rawByID := make(map[string]api.ProjectSourceRef)
	refByID := make(map[string]PromptTextSourceRef)
	rawCounts := make(map[string]int, len(definition.SourceRefs))
	for _, raw := range definition.SourceRefs {
		if raw.ID != "" {
			rawCounts[raw.ID]++
		}
	}
	for _, raw := range definition.SourceRefs {
		key := SourceRefKey{DefinitionID: definition.ID, SourceRefID: raw.ID}
		if raw.ID == "" || rawCounts[raw.ID] != 1 {
			continue
		}
		rawByID[raw.ID] = raw
		if ref, ok := normalizePromptTextRef(key, raw, root); ok {
			refs = append(refs, ref)
			refByID[raw.ID] = ref
		}
		if target, ok := normalizeRefactorTarget(key, raw, root); ok {
			refactors = append(refactors, target)
		}
	}
	joins := make([]FragmentJoin, 0)
	for _, owner := range refs {
		raw := rawByID[owner.Key.SourceRefID]
		for _, evidence := range decodeFragmentJoins(raw.Metadata) {
			target, ok := refByID[evidence.TargetSourceRefID]
			if !ok || !validJoinEvidence(owner, target, evidence) {
				continue
			}
			ownerLocation, ownerOK := sourceRangeLocation(evidence.OwnerTemplateRange, root)
			expression, expressionOK := sourceRangeLocation(evidence.ExpressionRange, root)
			targetLocation, targetOK := sourceRangeLocation(evidence.TargetTemplateRange, root)
			if !ownerOK || !expressionOK || !targetOK ||
				ownerLocation != owner.Template || targetLocation != target.Template ||
				!rangeContains(ownerLocation.Range, expression.Range) {
				continue
			}
			joins = append(joins, FragmentJoin{
				Key: FragmentJoinKey{
					DefinitionID: definition.ID, OwnerSourceRefID: evidence.OwnerSourceRefID,
					InterpolationIndex: evidence.InterpolationIndex,
					TargetSourceRefID:  evidence.TargetSourceRefID,
				},
				OwnerTemplate: ownerLocation, Expression: expression,
				TargetTemplate: targetLocation, Proof: evidence.Proof,
			})
		}
	}
	return refs, joins, refactors
}

func normalizePromptTextRef(
	key SourceRefKey,
	raw api.ProjectSourceRef,
	root string,
) (PromptTextSourceRef, bool) {
	metadata, ok := decodePromptTextMetadata(raw.Metadata)
	location, locationOK := snippetLocation(raw, root)
	if !ok || !locationOK || raw.Fidelity != "resolved" ||
		metadata.Tag != "md" ||
		metadata.Language != "markdown" ||
		!matchingPromptTextProperty(raw.Role, raw.Property) ||
		(metadata.Lifecycle != "static" && metadata.Lifecycle != "dynamic") ||
		!validSourceKind(metadata.SourceKind, raw.Symbol) {
		return PromptTextSourceRef{}, false
	}
	return PromptTextSourceRef{
		Key: key, Role: raw.Role, Property: raw.Property, Symbol: raw.Symbol,
		Lifecycle: metadata.Lifecycle, SourceKind: metadata.SourceKind,
		Fidelity: raw.Fidelity, Template: location,
	}, true
}

func normalizeRefactorTarget(
	key SourceRefKey,
	raw api.ProjectSourceRef,
	root string,
) (StringRefactorTarget, bool) {
	value, exists := raw.Metadata["promptTextRefactor"]
	_, hasPromptText := raw.Metadata["promptText"]
	if !exists || hasPromptText {
		return StringRefactorTarget{}, false
	}
	var evidence refactorMetadata
	if !decodeStrictValue(value, &evidence) ||
		evidence.Kind != "ordinary-string-to-md" ||
		evidence.Proof != "semantic-exact" ||
		evidence.Lifecycle != "static" ||
		evidence.Target != "md" ||
		!validRefactorBinding(evidence.Binding) ||
		raw.Fidelity != "resolved" ||
		!matchingPromptTextProperty(raw.Role, raw.Property) {
		return StringRefactorTarget{}, false
	}
	location, ok := snippetLocation(raw, root)
	if !ok {
		return StringRefactorTarget{}, false
	}
	return StringRefactorTarget{
		Key: key, Role: raw.Role, Property: raw.Property,
		Lifecycle: evidence.Lifecycle, Expression: location,
		Binding: evidence.Binding, Proof: evidence.Proof,
	}, true
}

func matchingPromptTextProperty(role, property string) bool {
	return role == property && (role == "prompt" || role == "system")
}

func validSourceKind(sourceKind PromptTextSourceKind, symbol string) bool {
	switch sourceKind {
	case PromptTextSourceOwner, PromptTextSourceAnonymousFragment:
		return symbol == ""
	case PromptTextSourceNamedFragment:
		return symbol != ""
	default:
		return false
	}
}

func decodePromptTextMetadata(metadata map[string]any) (promptTextMetadata, bool) {
	value, exists := metadata["promptText"]
	if !exists {
		return promptTextMetadata{}, false
	}
	var result promptTextMetadata
	if !decodeStrictValue(value, &result) {
		return promptTextMetadata{}, false
	}
	return result, true
}

func decodeFragmentJoins(metadata map[string]any) []fragmentJoinMetadata {
	promptText, ok := decodePromptTextMetadata(metadata)
	if !ok || len(promptText.FragmentJoins) == 0 {
		return nil
	}
	var joins []fragmentJoinMetadata
	if !decodeStrictJSON(promptText.FragmentJoins, &joins) || joins == nil {
		return nil
	}
	return joins
}

func decodeStrictValue(value any, target any) bool {
	data, err := json.Marshal(value)
	return err == nil && decodeStrictJSON(data, target)
}

func decodeStrictJSON(data []byte, target any) bool {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return false
	}
	return decoder.Decode(&struct{}{}) == io.EOF
}

func validRefactorBinding(binding RefactorBinding) bool {
	if len(binding.Expression) == 0 || len(binding.Expression) > 256 {
		return false
	}
	switch binding.Kind {
	case "identifier":
		return identifier(binding.Expression)
	case "namespace-access":
		parts := strings.Split(binding.Expression, ".")
		return len(parts) == 2 && identifier(parts[0]) && identifier(parts[1])
	default:
		return false
	}
}

func identifier(value string) bool {
	if value == "" {
		return false
	}
	for index, r := range value {
		if r == '_' || r == '$' ||
			r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' ||
			index > 0 && r >= '0' && r <= '9' {
			continue
		}
		return false
	}
	return true
}

func snippetLocation(raw api.ProjectSourceRef, root string) (Location, bool) {
	if raw.Snippet == nil || raw.Snippet.Truncated ||
		raw.Source.File == "" || raw.Snippet.Range.File == "" ||
		canonicalFile(root, raw.Source.File) != canonicalFile(root, raw.Snippet.Range.File) {
		return Location{}, false
	}
	return sourceRangeLocation(raw.Snippet.Range, root)
}

func validJoinEvidence(
	owner, target PromptTextSourceRef,
	evidence fragmentJoinMetadata,
) bool {
	return evidence.Kind == "named-fragment" &&
		evidence.Proof == "semantic-exact" &&
		evidence.OwnerSourceRefID == owner.Key.SourceRefID &&
		evidence.TargetSourceRefID == target.Key.SourceRefID &&
		target.SourceKind == PromptTextSourceNamedFragment &&
		owner.Role == target.Role &&
		owner.Property == target.Property &&
		owner.Lifecycle == target.Lifecycle
}

func rangeContains(outer, inner protocol.Range) bool {
	return comparePosition(outer.Start, inner.Start) <= 0 &&
		comparePosition(inner.End, outer.End) <= 0
}

func refSignature(value PromptTextSourceRef) string {
	return strings.Join([]string{
		value.Role, value.Property, value.Symbol, value.Lifecycle,
		string(value.SourceKind), value.Fidelity,
	}, "\x00")
}

func joinSignature(value FragmentJoin) string {
	return fragmentJoinKey(value.Key) + "\x00" + value.Proof
}

func refactorSignature(value StringRefactorTarget) string {
	return strings.Join([]string{
		value.Role, value.Property, value.Lifecycle, value.Binding.Kind,
		value.Binding.Expression, value.Proof,
	}, "\x00")
}
