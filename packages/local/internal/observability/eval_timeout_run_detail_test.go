package observability

import (
	"context"
	"encoding/json"
	"testing"
)

func TestEvalTimeoutRunDetailRetainsStructuredCancelledTerminal(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"eval-timeout-start","type":"run:start","runId":"run-eval-timeout","operationId":"run-eval-timeout","segmentId":"segment-eval-timeout","segmentSeq":1,"traceId":"trace-eval-timeout","name":"support:refund:current","rootPrimitive":"eval.case","startedAt":"2026-07-27T12:00:00.000Z","status":"running","attributes":{"evalId":"support","caseId":"refund","variant":"current","trial":0}}`,
		`{"schemaVersion":2,"recordId":"eval-timeout-span-start","type":"span:start","runId":"run-eval-timeout","operationId":"run-eval-timeout","segmentId":"segment-eval-timeout","segmentSeq":2,"traceId":"trace-eval-timeout","spanId":"span-generation","parentSpanId":null,"family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-07-27T12:00:00.100Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"eval-timeout-span-end","type":"span:end","runId":"run-eval-timeout","operationId":"run-eval-timeout","segmentId":"segment-eval-timeout","segmentSeq":3,"traceId":"trace-eval-timeout","spanId":"span-generation","endedAt":"2026-07-27T12:00:00.750Z","durationMs":650,"status":"cancelled"}`,
		`{"schemaVersion":2,"recordId":"eval-timeout-end","type":"run:end","runId":"run-eval-timeout","operationId":"run-eval-timeout","segmentId":"segment-eval-timeout","segmentSeq":4,"traceId":"trace-eval-timeout","endedAt":"2026-07-27T12:00:00.750Z","durationMs":750,"status":"cancelled","attributes":{"evalOutcome":"timed_out","timeoutBudget":"chunk","timeoutLimitMs":750}}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-eval-timeout")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	if detail.Run.RootPrimitive != "eval.case" || detail.Run.Status != "cancelled" {
		t.Fatalf("run terminal = %s/%s, want eval.case/cancelled", detail.Run.RootPrimitive, detail.Run.Status)
	}
	if len(detail.Run.Error) != 0 {
		t.Fatalf("run error = %s, want none", detail.Run.Error)
	}
	var attributes map[string]any
	if err := json.Unmarshal(detail.Run.Attributes, &attributes); err != nil {
		t.Fatalf("decode attributes: %v", err)
	}
	if attributes["evalOutcome"] != "timed_out" ||
		attributes["timeoutBudget"] != "chunk" ||
		attributes["timeoutLimitMs"] != float64(750) {
		t.Fatalf("timeout attributes = %#v", attributes)
	}
	child := findRunDetailNode(&detail.Root, "span-generation")
	if child == nil || child.Primitive != "generation.call" {
		t.Fatalf("generation child = %#v", child)
	}
}
