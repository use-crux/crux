package observability

import (
	"encoding/json"
	"testing"
)

func TestSafetyDecisionProjectsAdditionalSafeOrigins(t *testing.T) {
	tests := map[string]struct {
		attributes string
		want       *TurnModelInputOrigin
	}{
		"memory": {
			`{"inputSource":"memory","inputOriginKind":"memory-context","memoryId":"conversation","blockIndex":1}`,
			&TurnModelInputOrigin{Source: "memory", Kind: "memory-context", MemoryID: "conversation", BlockIndex: intPointer(1)},
		},
		"blackboard": {
			`{"inputSource":"memory","inputOriginKind":"blackboard-context","boardId":"shared-plan","blockIndex":2}`,
			&TurnModelInputOrigin{Source: "memory", Kind: "blackboard-context", BoardID: "shared-plan", BlockIndex: intPointer(2)},
		},
		"handoff": {
			`{"inputSource":"handoff","inputOriginKind":"handoff-context","handoffId":"delegation-1","blockIndex":3}`,
			&TurnModelInputOrigin{Source: "handoff", Kind: "handoff-context", HandoffID: "delegation-1", BlockIndex: intPointer(3)},
		},
		"feedback": {
			`{"inputSource":"feedback","inputOriginKind":"rejected-output","attempt":2}`,
			&TurnModelInputOrigin{Source: "feedback", Kind: "rejected-output", Attempt: intPointer(2)},
		},
		"instructions": {
			`{"inputSource":"instructions","inputOriginKind":"context","contextId":"authored-context","blockIndex":4}`,
			&TurnModelInputOrigin{Source: "instructions", Kind: "context", ContextID: "authored-context", BlockIndex: intPointer(4)},
		},
		"discovered tool schema description": {
			`{"inputSource":"tool-definition","inputOriginKind":"discovered","toolName":"search","toolSourceId":"catalog","toolSourceKind":"registry","descriptionKind":"schema","schemaDepth":2}`,
			&TurnModelInputOrigin{
				Source: "tool-definition", Kind: "discovered", ToolName: "search",
				ToolSourceID: "catalog", ToolSourceKind: "registry",
				DescriptionKind: "schema", SchemaDepth: intPointer(2),
			},
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			decision := safetyDecisionForAttributes(json.RawMessage(`{
				"boundary":"model.input.text",
				"mode":"enforce",
				"action":"allow",
				` + test.attributes[1:]))
			if decision == nil || !equalJSONValues(decision.Origin, test.want) {
				t.Fatalf("origin = %#v, want %#v", decision, test.want)
			}
		})
	}
}

func TestSafetyDecisionAdditionalOriginsOmitOpaqueFields(t *testing.T) {
	decision := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.input.tools",
		"mode":"enforce",
		"action":"rewrite",
		"inputSource":"tool-definition",
		"inputOriginKind":"authored",
		"toolName":"lookup",
		"descriptionKind":"tool",
		"schemaPath":"properties.private.description",
		"content":"PRIVATE_DESCRIPTION",
		"metadata":{"private":"PRIVATE_METADATA"}
	}`))
	raw, err := json.Marshal(decision)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"target":{"id":"model.input.tools","label":"Model input · Tools"},"mode":"enforce","changed":true,"origin":{"source":"tool-definition","kind":"authored","toolName":"lookup","descriptionKind":"tool"}}` {
		t.Fatalf("decision leaked or lost safe fields: %s", raw)
	}
}
