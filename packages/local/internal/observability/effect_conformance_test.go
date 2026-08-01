package observability

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSharedEffectFixtureProjectsCanonicalRecords(t *testing.T) {
	raw := readCoreObservabilityFixture(t, "effect-v5.json")
	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}

	service := newTestService(t)
	if err := service.Ingest(context.Background(), batch); err != nil {
		t.Fatalf("ingest shared effect fixture: %v", err)
	}

	graph, err := service.Graph(context.Background(), "run_effect_fixture")
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Spans) != 2 {
		t.Fatalf("span count = %d, want 2", len(graph.Spans))
	}
	for _, span := range graph.Spans {
		if span.Family != "effect" || span.Primitive != "effect.run" {
			t.Fatalf("span taxonomy = %q/%q, want effect/effect.run", span.Family, span.Primitive)
		}
	}
	if len(graph.Artifacts) != 2 {
		t.Fatalf("artifact count = %d, want 2", len(graph.Artifacts))
	}
	for _, artifact := range graph.Artifacts {
		if artifact.Kind != "effect.receipt" {
			t.Fatalf("artifact kind = %q, want effect.receipt", artifact.Kind)
		}
		var preview map[string]any
		if err := json.Unmarshal(artifact.Preview, &preview); err != nil {
			t.Fatalf("decode receipt preview: %v", err)
		}
		if preview["kind"] != "effect.receipt" {
			t.Fatalf("receipt preview kind = %#v, want effect.receipt", preview["kind"])
		}
	}
	if len(graph.Edges) != 1 {
		t.Fatalf("edge count = %d, want 1", len(graph.Edges))
	}
	edge := graph.Edges[0]
	if edge.EdgeType != "recovery.of" ||
		edge.From != (NodeRef{Kind: "span", ID: "2222222222222222"}) ||
		edge.To != (NodeRef{Kind: "span", ID: "1111111111111111"}) {
		t.Fatalf("recovery edge = %#v", edge)
	}
}

func TestValidateEffectQualifiedRecords(t *testing.T) {
	raw := readCoreObservabilityFixture(t, "effect-v5.json")
	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name        string
		record      Record
		mutate      func(map[string]any)
		wantErrPart string
	}{
		{
			name:   "effect run requires canonical attributes",
			record: batch.Records[0],
			mutate: func(payload map[string]any) {
				delete(payload["attributes"].(map[string]any), "crux.effect.scope.id")
			},
			wantErrPart: "crux.effect.scope.id",
		},
		{
			name:   "receipt preview rejects recovery envelope data",
			record: batch.Records[1],
			mutate: func(payload map[string]any) {
				payload["preview"].(map[string]any)["input"] = map[string]any{"token": "secret"}
			},
			wantErrPart: "unknown field",
		},
		{
			name:   "receipt requires inline JSON",
			record: batch.Records[1],
			mutate: func(payload map[string]any) {
				payload["encoding"] = "utf8"
			},
			wantErrPart: "inline JSON",
		},
		{
			name:   "recovery relationship requires span nodes",
			record: batch.Records[5],
			mutate: func(payload map[string]any) {
				payload["from"].(map[string]any)["kind"] = "artifact"
			},
			wantErrPart: "span",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := mutateRecordPayload(t, test.record, test.mutate)
			err := ValidateRecord(record)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if !strings.Contains(err.Error(), test.wantErrPart) {
				t.Fatalf("error = %q, want %q", err, test.wantErrPart)
			}
		})
	}
}

func mutateRecordPayload(t *testing.T, record Record, mutate func(map[string]any)) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	mutate(payload)
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var mutated Record
	if err := json.Unmarshal(raw, &mutated); err != nil {
		t.Fatal(err)
	}
	return mutated
}
