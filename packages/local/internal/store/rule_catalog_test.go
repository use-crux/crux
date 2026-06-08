package store

import (
	"encoding/json"
	"testing"
)

func TestIndexDataPreservesRuleCatalogJSON(t *testing.T) {
	input := []byte(`{
		"schemaVersion": 1,
		"prompts": [],
		"contexts": [],
		"tools": [],
		"ruleCatalog": [{
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
	if len(index.RuleCatalog) != 1 {
		t.Fatalf("RuleCatalog len = %d, want 1", len(index.RuleCatalog))
	}
	if index.RuleCatalog[0].ID != "prompt.missing_input_schema" {
		t.Fatalf("RuleCatalog[0].ID = %q", index.RuleCatalog[0].ID)
	}

	output, err := json.Marshal(index)
	if err != nil {
		t.Fatalf("marshal IndexData: %v", err)
	}
	var roundTrip map[string]any
	if err := json.Unmarshal(output, &roundTrip); err != nil {
		t.Fatalf("unmarshal marshaled IndexData: %v", err)
	}
	if _, ok := roundTrip["ruleCatalog"]; !ok {
		t.Fatal("marshaled IndexData missing ruleCatalog")
	}
}
