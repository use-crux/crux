package eventwire

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// IndexFactGroup identifies one V3 patch fact field. Values are ordered by the
// cross-language worker contract, not alphabetically.
type IndexFactGroup string

const (
	IndexFactGroupPrompts         IndexFactGroup = "prompts"
	IndexFactGroupContexts        IndexFactGroup = "contexts"
	IndexFactGroupTools           IndexFactGroup = "tools"
	IndexFactGroupLint            IndexFactGroup = "lint"
	IndexFactGroupDefinitions     IndexFactGroup = "definitions"
	IndexFactGroupRelations       IndexFactGroup = "relations"
	IndexFactGroupSourceRefs      IndexFactGroup = "sourceRefs"
	IndexFactGroupDiagnostics     IndexFactGroup = "diagnostics"
	IndexFactGroupLintFindings    IndexFactGroup = "lintFindings"
	IndexFactGroupRuleDescriptors IndexFactGroup = "ruleDescriptors"
	IndexFactGroupSources         IndexFactGroup = "sources"
	IndexFactGroupSourceGraph     IndexFactGroup = "sourceGraph"
)

var canonicalIndexFactGroups = []IndexFactGroup{
	IndexFactGroupPrompts,
	IndexFactGroupContexts,
	IndexFactGroupTools,
	IndexFactGroupLint,
	IndexFactGroupDefinitions,
	IndexFactGroupRelations,
	IndexFactGroupSourceRefs,
	IndexFactGroupDiagnostics,
	IndexFactGroupLintFindings,
	IndexFactGroupRuleDescriptors,
	IndexFactGroupSources,
	IndexFactGroupSourceGraph,
}

// DecodedFactGroups preserves whether a V3 phase summary declared presence.
// Present empty and legacy omission intentionally have different values.
type DecodedFactGroups struct {
	Present bool
	Value   []IndexFactGroup
}

// DecodeFactGroups validates the optional V3 fact-group declaration.
//
// Nil or zero-length bytes identify a legacy omission. Every present value
// must be one canonical, unique JSON string array; null and trailing content
// are rejected so explicit empty presence cannot collapse into omission.
func DecodeFactGroups(raw json.RawMessage) (DecodedFactGroups, error) {
	if len(raw) == 0 {
		return DecodedFactGroups{}, nil
	}
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		return DecodedFactGroups{}, fmt.Errorf("factGroups cannot be null")
	}

	var elements []json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&elements); err != nil {
		return DecodedFactGroups{}, fmt.Errorf("decode factGroups: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return DecodedFactGroups{}, fmt.Errorf("decode factGroups: expected one JSON value")
	}
	if elements == nil {
		return DecodedFactGroups{}, fmt.Errorf("factGroups must be an array")
	}

	groups := make([]IndexFactGroup, 0, len(elements))
	previous := -1
	for _, element := range elements {
		value, err := decodeFactGroup(element)
		if err != nil {
			return DecodedFactGroups{}, err
		}
		position := indexFactGroupPosition(value)
		if position < 0 {
			return DecodedFactGroups{}, fmt.Errorf("unknown factGroup %q", value)
		}
		if position <= previous {
			return DecodedFactGroups{}, fmt.Errorf("factGroups must be unique and canonically ordered")
		}
		groups = append(groups, value)
		previous = position
	}
	return DecodedFactGroups{Present: true, Value: groups}, nil
}

func decodeFactGroup(raw json.RawMessage) (IndexFactGroup, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '"' {
		return "", fmt.Errorf("factGroup must be a string")
	}
	var value string
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return "", fmt.Errorf("decode factGroup: %w", err)
	}
	return IndexFactGroup(value), nil
}

func indexFactGroupPosition(group IndexFactGroup) int {
	for index, candidate := range canonicalIndexFactGroups {
		if group == candidate {
			return index
		}
	}
	return -1
}

func reconstructDeclaredFactGroups(
	facts IndexPatchFacts,
	decoded DecodedFactGroups,
	envelopes []IndexFactEnvelope,
) (IndexPatchFacts, error) {
	if !decoded.Present {
		return facts, nil
	}

	declared := make(map[IndexFactGroup]bool, len(decoded.Value))
	counts := make(map[IndexFactGroup]int, len(decoded.Value))
	for _, group := range decoded.Value {
		declared[group] = true
	}
	for _, envelope := range envelopes {
		group := IndexFactGroup(envelope.Kind)
		if indexFactGroupPosition(group) < 0 || !declared[group] {
			return IndexPatchFacts{}, fmt.Errorf("fact envelope group %q is undeclared", envelope.Kind)
		}
		counts[group]++
	}
	for _, group := range decoded.Value {
		if isSingletonFactGroup(group) && counts[group] != 1 {
			return IndexPatchFacts{}, fmt.Errorf(
				"singleton fact group %q emitted %d facts, want exactly one",
				group,
				counts[group],
			)
		}
		initializeDeclaredFactGroup(&facts, group)
	}
	return facts, nil
}

func initializeDeclaredFactGroup(facts *IndexPatchFacts, group IndexFactGroup) {
	switch group {
	case IndexFactGroupPrompts:
		facts.Prompts = nonNilFactSlice(facts.Prompts)
	case IndexFactGroupContexts:
		facts.Contexts = nonNilFactSlice(facts.Contexts)
	case IndexFactGroupTools:
		facts.Tools = nonNilFactSlice(facts.Tools)
	case IndexFactGroupDefinitions:
		facts.Definitions = nonNilFactSlice(facts.Definitions)
	case IndexFactGroupRelations:
		facts.Relations = nonNilFactSlice(facts.Relations)
	case IndexFactGroupSourceRefs:
		facts.SourceRefs = nonNilFactSlice(facts.SourceRefs)
	case IndexFactGroupDiagnostics:
		facts.Diagnostics = nonNilFactSlice(facts.Diagnostics)
	case IndexFactGroupLintFindings:
		facts.LintFindings = nonNilFactSlice(facts.LintFindings)
	case IndexFactGroupRuleDescriptors:
		facts.RuleDescriptors = nonNilFactSlice(facts.RuleDescriptors)
	case IndexFactGroupSources:
		facts.Sources = nonNilFactSlice(facts.Sources)
	case IndexFactGroupLint, IndexFactGroupSourceGraph:
	}
}

func isSingletonFactGroup(group IndexFactGroup) bool {
	return group == IndexFactGroupLint || group == IndexFactGroupSourceGraph
}

func nonNilFactSlice[T any](values []T) []T {
	if values == nil {
		return make([]T, 0)
	}
	return values
}
