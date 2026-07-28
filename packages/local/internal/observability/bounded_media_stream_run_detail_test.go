package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestBoundedMediaStreamRunDetailPreservesSafeLogicalAndAttemptFacts(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"stream-run-start","type":"run:start","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":1,"traceId":"stream-trace","name":"streamImage","rootPrimitive":"media.generate_image","startedAt":"2026-07-28T12:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"stream-logical-start","type":"span:start","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":2,"traceId":"stream-trace","spanId":"stream-logical","parentSpanId":null,"family":"media","primitive":"media.generate_image","name":"streamImage","startedAt":"2026-07-28T12:00:00.001Z","status":"running","attributes":{"provider":"openai","operation":"streamImage","streamingRole":"logical","model":"gpt-image-1","route":"fallback"},"definitionRefs":[{"id":"media.operation:cover","kind":"media.operation","role":"invoked-media-operation"}]}`,
		`{"schemaVersion":2,"recordId":"stream-attempt-1-start","type":"span:start","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":3,"traceId":"stream-trace","spanId":"stream-attempt-1","parentSpanId":"stream-logical","family":"media","primitive":"media.generate_image","name":"streamImage attempt primary","startedAt":"2026-07-28T12:00:00.002Z","status":"running","attributes":{"provider":"openai","operation":"streamImage","streamingRole":"attempt","model":"primary","attempt":1}}`,
		`{"schemaVersion":2,"recordId":"stream-attempt-1-end","type":"span:end","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":4,"traceId":"stream-trace","spanId":"stream-attempt-1","endedAt":"2026-07-28T12:00:00.012Z","durationMs":10,"status":"error","attributes":{"terminal":"error","committed":false,"previewCount":0,"deltaCount":1,"finalCount":0,"byteCount":100,"mediaTypes":["image/png"]}}`,
		`{"schemaVersion":2,"recordId":"stream-attempt-2-start","type":"span:start","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":5,"traceId":"stream-trace","spanId":"stream-attempt-2","parentSpanId":"stream-logical","family":"media","primitive":"media.generate_image","name":"streamImage attempt backup","startedAt":"2026-07-28T12:00:00.013Z","status":"running","attributes":{"provider":"openai","operation":"streamImage","streamingRole":"attempt","model":"backup","attempt":2}}`,
		`{"schemaVersion":2,"recordId":"stream-safety","type":"artifact","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":6,"traceId":"stream-trace","spanId":"stream-attempt-2","artifactId":"stream-safety-report","kind":"guardrail.report","createdAt":"2026-07-28T12:00:00.020Z","contentType":"application/json","encoding":"json","sizeBytes":1,"preview":{"kind":"guardrail.report","target":{"id":"model.output.media","label":"Model output · Media"},"mode":"enforce","phase":"output","action":"allow","originKind":"operation","operation":"streamImage","operationPhase":"final","field":"images","outputIndex":0,"mediaPartType":"image"}}`,
		`{"schemaVersion":2,"recordId":"stream-attempt-2-end","type":"span:end","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":7,"traceId":"stream-trace","spanId":"stream-attempt-2","endedAt":"2026-07-28T12:00:00.030Z","durationMs":17,"status":"ok","attributes":{"terminal":"ok","committed":true,"previewCount":1,"deltaCount":2,"finalCount":1,"byteCount":900,"mediaTypes":["image/png"]}}`,
		`{"schemaVersion":2,"recordId":"stream-logical-end","type":"span:end","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":8,"traceId":"stream-trace","spanId":"stream-logical","endedAt":"2026-07-28T12:00:00.042Z","durationMs":41,"status":"ok","attributes":{"provider":"openai","operation":"streamImage","model":"backup","calls":1,"attemptCount":2,"committed":true,"terminal":"ok","previewCount":1,"deltaCount":2,"finalCount":1,"byteCount":900,"mediaTypes":["image/png"],"firstEventMs":12,"durationMs":41}}`,
		`{"schemaVersion":2,"recordId":"stream-run-end","type":"run:end","runId":"run-stream","operationId":"run-stream","segmentId":"stream-segment","segmentSeq":9,"traceId":"stream-trace","endedAt":"2026-07-28T12:00:00.043Z","durationMs":43,"status":"ok"}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-stream")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	logical := findRunDetailNode(&detail.Root, "stream-logical")
	if logical == nil {
		t.Fatal("logical stream missing")
	}
	logicalFacts := decodeStreamAttributes(t, logical.Attributes)
	assertStreamFact(t, logicalFacts, "operation", "streamImage")
	assertStreamFact(t, logicalFacts, "streamingRole", "logical")
	assertStreamFact(t, logicalFacts, "terminal", "ok")
	assertStreamFact(t, logicalFacts, "attemptCount", float64(2))
	assertStreamFact(t, logicalFacts, "byteCount", float64(900))
	if len(logical.DefinitionRefs) != 1 || logical.DefinitionRefs[0].ID != "media.operation:cover" {
		t.Fatalf("logical definition refs = %#v", logical.DefinitionRefs)
	}
	if len(logical.Children) != 2 {
		t.Fatalf("physical attempts = %d, want 2", len(logical.Children))
	}
	for index := range logical.Children {
		facts := decodeStreamAttributes(t, logical.Children[index].Attributes)
		assertStreamFact(t, facts, "streamingRole", "attempt")
		assertStreamFact(t, facts, "attempt", float64(index+1))
	}
	if len(logical.Children[1].Artifacts) != 1 {
		t.Fatalf("Safety artifacts = %d, want 1", len(logical.Children[1].Artifacts))
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"PRIVATE_PROMPT", "base64", "filename", "asset://", "https://", "SECRET", "heldBytes"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("run detail retained forbidden %q", forbidden)
		}
	}
}

func TestBoundedMediaStreamRunDetailPreservesTerminalVariants(t *testing.T) {
	for _, test := range []struct {
		operation string
		primitive string
		terminal  string
		committed bool
	}{
		{"streamImage", "media.generate_image", "error", true},
		{"streamSpeech", "media.generate_speech", "cancelled", false},
		{"streamSpeech", "media.generate_speech", "timeout", false},
	} {
		t.Run(test.terminal, func(t *testing.T) {
			attributes, err := json.Marshal(map[string]any{
				"operation": test.operation, "streamingRole": "logical",
				"terminal": test.terminal, "committed": test.committed,
				"attemptCount": 1, "previewCount": 0, "deltaCount": 2,
				"finalCount": 0, "byteCount": 480, "mediaTypes": []string{"audio/pcm"},
				"firstEventMs": 8, "durationMs": 25,
			})
			if err != nil {
				t.Fatal(err)
			}
			detail := ProjectRunDetail(Graph{
				Run: RunSummary{RunID: "terminal-" + test.terminal, RootPrimitive: test.primitive, Status: test.terminal},
				Spans: []SpanSummary{{
					SpanID: "logical", RunID: "terminal-" + test.terminal,
					Family: "media", Primitive: test.primitive, Name: test.operation,
					Status: test.terminal, DurationMs: 25, Attributes: attributes,
				}},
			}, DefaultProjectionOptions())
			logical := findRunDetailNode(&detail.Root, "logical")
			if logical == nil {
				t.Fatal("logical stream missing")
			}
			facts := decodeStreamAttributes(t, logical.Attributes)
			assertStreamFact(t, facts, "terminal", test.terminal)
			assertStreamFact(t, facts, "committed", test.committed)
			assertStreamFact(t, facts, "firstEventMs", float64(8))
		})
	}
}

func decodeStreamAttributes(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var attributes map[string]any
	if err := json.Unmarshal(raw, &attributes); err != nil {
		t.Fatalf("decode attributes: %v", err)
	}
	return attributes
}

func assertStreamFact(t *testing.T, attributes map[string]any, key string, want any) {
	t.Helper()
	if got := attributes[key]; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}
