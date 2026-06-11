package store

import (
	"encoding/json"
	"testing"
)

func TestIndexDataPreservesRuleDescriptorsJSON(t *testing.T) {
	input := []byte(`{
		"schemaVersion": 1,
		"prompts": [],
		"contexts": [],
		"tools": [],
		"ruleDescriptors": [{
			"id": "prompt.missing_input_schema",
			"source": "builtin",
			"severity": "info",
			"category": "contracts",
			"title": "Prompt has no input schema",
			"description": "Prompt inputs should be inspectable.",
			"suppression": {
				"supported": true,
				"scope": "next-line",
				"directive": "// crux-lint-disable-next-line prompt.missing_input_schema -- reason"
			},
			"optionSchema": {"type": "object"},
			"defaultOptions": [{"enabled": true}]
		}]
	}`)

	var index IndexData
	if err := json.Unmarshal(input, &index); err != nil {
		t.Fatalf("unmarshal IndexData: %v", err)
	}
	if len(index.RuleDescriptors) != 1 {
		t.Fatalf("RuleDescriptors len = %d, want 1", len(index.RuleDescriptors))
	}
	if index.RuleDescriptors[0].ID != "prompt.missing_input_schema" {
		t.Fatalf("RuleDescriptors[0].ID = %q", index.RuleDescriptors[0].ID)
	}

	output, err := json.Marshal(index)
	if err != nil {
		t.Fatalf("marshal IndexData: %v", err)
	}
	var roundTrip map[string]any
	if err := json.Unmarshal(output, &roundTrip); err != nil {
		t.Fatalf("unmarshal marshaled IndexData: %v", err)
	}
	if _, ok := roundTrip["ruleDescriptors"]; !ok {
		t.Fatal("marshaled IndexData missing ruleDescriptors")
	}
}
