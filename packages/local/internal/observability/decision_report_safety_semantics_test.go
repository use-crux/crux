package observability

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSafetyDecisionProjectsInstructionAndOutputTargetsWithoutInputOrigin(t *testing.T) {
	instructions := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.instructions",
		"mode":"enforce",
		"action":"allow"
	}`))
	output := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.output.text",
		"mode":"enforce",
		"action":"rewrite"
	}`))

	if instructions == nil || instructions.Target.Label != "Model instructions" || instructions.Origin != nil {
		t.Fatalf("instructions = %#v, want labeled target without origin", instructions)
	}
	if output == nil || output.Target.Label != "model.output.text" || output.Origin != nil {
		t.Fatalf("output = %#v, want safe target fallback without origin", output)
	}
}

func TestSafetyDecisionOmitsMalformedPartialOrigins(t *testing.T) {
	for name, attributes := range map[string]string{
		"missing source":       `{"inputOriginKind":"message"}`,
		"missing kind":         `{"inputSource":"user"}`,
		"unknown user kind":    `{"inputSource":"user","inputOriginKind":"future-message"}`,
		"tool without name":    `{"inputSource":"tool","inputOriginKind":"tool-result"}`,
		"retrieval without id": `{"inputSource":"retrieval","inputOriginKind":"retrieval-context"}`,
	} {
		t.Run(name, func(t *testing.T) {
			decision := safetyDecisionForAttributes(json.RawMessage(`{
				"boundary":"model.input.text",
				"mode":"enforce",
				"action":"allow",
				` + attributes[1:]))
			if decision == nil {
				t.Fatal("safety decision is nil")
			}
			if decision.Origin != nil {
				t.Fatalf("origin = %#v, want malformed origin omitted", decision.Origin)
			}
		})
	}
}

func TestSafetyDecisionSafelyFallsBackForUnknownTargetAndSource(t *testing.T) {
	decision := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"future.model.input",
		"mode":"enforce",
		"action":"allow",
		"inputSource":"connector",
		"inputOriginKind":"connector-result",
		"toolName":"must-not-project",
		"partIndex":4
	}`))
	if decision == nil || decision.Target.ID != "future.model.input" || decision.Target.Label != "future.model.input" {
		t.Fatalf("target = %#v, want id fallback", decision)
	}
	want := &TurnModelInputOrigin{Source: "connector", Kind: "connector-result"}
	if !equalJSONValues(decision.Origin, want) {
		t.Fatalf("origin = %#v, want source/kind-only fallback %#v", decision.Origin, want)
	}
}

func TestSafetyDecisionOmitsObjectWithoutCanonicalBoundaryAndMode(t *testing.T) {
	for name, attributes := range map[string]json.RawMessage{
		"missing boundary": json.RawMessage(`{"mode":"enforce","action":"rewrite"}`),
		"missing mode":     json.RawMessage(`{"boundary":"model.input.text","action":"rewrite"}`),
		"unknown mode":     json.RawMessage(`{"boundary":"model.input.text","mode":"audit","action":"rewrite"}`),
		"blank boundary":   json.RawMessage(`{"boundary":"   ","mode":"enforce","action":"rewrite"}`),
	} {
		t.Run(name, func(t *testing.T) {
			if decision := safetyDecisionForAttributes(attributes); decision != nil {
				t.Fatalf("decision = %#v, want safety omitted", decision)
			}
			decision := guardDecisionForSpan(
				SpanSummary{SpanID: "span_generation"},
				SpanSummary{SpanID: "span_guardrail", Primitive: "guardrail.run", Attributes: attributes},
				"guardrail",
				"Guardrail",
			)
			raw, err := json.Marshal(decision)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), `"safety"`) {
				t.Fatalf("marshalled decision = %s, want safety field omitted", raw)
			}
		})
	}
}

func TestSafetyDecisionDoesNotClaimNonMutatingActionsChangedContent(t *testing.T) {
	for _, action := range []string{"allow", "warn", "block", "request_approval", "future-action"} {
		t.Run(action, func(t *testing.T) {
			decision := safetyDecisionForAttributes(json.RawMessage(`{
				"boundary":"model.input.text",
				"mode":"enforce",
				"action":"` + action + `"
			}`))
			if decision == nil || decision.Changed {
				t.Fatalf("decision = %#v, want unchanged", decision)
			}
		})
	}
}
