package host

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type evidenceBatchResult struct {
	Method      string            `json:"method"`
	Root        string            `json:"root"`
	Facts       json.RawMessage   `json:"facts"`
	Diagnostics []json.RawMessage `json:"diagnostics"`
}

type ruleCheckResult struct {
	Method          string            `json:"method"`
	Root            string            `json:"root"`
	Facts           json.RawMessage   `json:"facts"`
	Diagnostics     []json.RawMessage `json:"diagnostics"`
	RuleDescriptors []json.RawMessage `json:"ruleDescriptors"`
}

func DecodeManifest(raw json.RawMessage, root string) (projectindex.StaticExtensionHostManifestResult, error) {
	var result projectindex.StaticExtensionHostManifestResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return projectindex.StaticExtensionHostManifestResult{}, fmt.Errorf("decode static extension host manifest: %w", err)
	}
	if result.Method != "loadStaticExtensionHostManifest" {
		return projectindex.StaticExtensionHostManifestResult{}, fmt.Errorf("static extension host manifest method %q, want loadStaticExtensionHostManifest", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return projectindex.StaticExtensionHostManifestResult{}, fmt.Errorf("static extension host manifest root = %s, want %s", result.Root, root)
	}
	return result, nil
}

func DecodeEvidenceFacts(raw json.RawMessage, root string) ([]json.RawMessage, error) {
	var result evidenceBatchResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode static extension evidence result: %w", err)
	}
	if result.Method != "extractStaticEvidenceBatch" {
		return nil, fmt.Errorf("static extension evidence method %q, want extractStaticEvidenceBatch", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return nil, fmt.Errorf("static extension evidence root = %s, want %s", result.Root, root)
	}
	return NonEmptyGroupedFacts(result.Facts), nil
}

func DecodeRuleFacts(raw json.RawMessage, root string) ([]json.RawMessage, error) {
	var result ruleCheckResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode static rule check result: %w", err)
	}
	if result.Method != "checkStaticRules" {
		return nil, fmt.Errorf("static rule check method %q, want checkStaticRules", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return nil, fmt.Errorf("static rule check root = %s, want %s", result.Root, root)
	}
	return NonEmptyGroupedFacts(result.Facts), nil
}

func FinalizerFacts(plan projectindex.ProjectStaticSyntaxPlan) ([]json.RawMessage, error) {
	facts := []json.RawMessage{}
	if fact, ok, err := GroupedFact("sourceGraph", plan.SourceGraph); err != nil {
		return nil, err
	} else if ok {
		facts = append(facts, fact)
	}
	if fact, ok, err := GroupedFact("ruleDescriptors", plan.RuleDescriptors); err != nil {
		return nil, err
	} else if ok {
		facts = append(facts, fact)
	}
	return facts, nil
}

func GroupedFact(key string, value json.RawMessage) (json.RawMessage, bool, error) {
	value = bytes.TrimSpace(value)
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return nil, false, nil
	}
	data, err := json.Marshal(map[string]json.RawMessage{key: value})
	if err != nil {
		return nil, false, fmt.Errorf("native static grouped %s facts: %w", key, err)
	}
	return data, true, nil
}

func NonEmptyGroupedFacts(raw json.RawMessage) []json.RawMessage {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) || bytes.Equal(raw, []byte("{}")) {
		return nil
	}
	return []json.RawMessage{append(json.RawMessage(nil), raw...)}
}
