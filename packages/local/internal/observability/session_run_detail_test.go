package observability

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSessionTurnRunDetailRetainsSafeOperationalProjection(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"schemaVersion":5,"recordId":"session-start","type":"run:start","runId":"run-session-turn","operationId":"run-session-turn","sessionId":"session-42","segmentId":"session-segment","segmentSeq":1,"traceId":"session-trace","name":"session turn","rootPrimitive":"session.turn","startedAt":"2026-08-04T12:00:00.000Z","status":"running","attributes":{"sessionId":"session-42","inputId":"input-4","workId":"work-4","cursor":"4","threadId":"thread-42"}}`,
		`{"schemaVersion":5,"recordId":"session-end","type":"run:end","runId":"run-session-turn","operationId":"run-session-turn","sessionId":"session-42","segmentId":"session-segment","segmentSeq":2,"traceId":"session-trace","endedAt":"2026-08-04T12:00:01.000Z","durationMs":1000,"status":"blocked","attributes":{"outcome":"blocked","session":{"schema":1,"identity":{"sessionId":"session-42","keyHash":"key-fingerprint","targetId":"support","threadId":"thread-42"},"status":{"state":"blocked","acceptedCursor":"4","processedCursor":"3","pendingInputs":1,"pendingWork":1},"wakePending":false,"thread":{"revision":"thread-revision"},"inputs":[{"inputId":"input-4","cursor":"4","state":"blocked","workId":"work-4","checkpointPrepared":true}],"checkpoint":{"inputId":"input-4","workId":"work-4","checkpointedAt":"2026-08-04T12:00:00.900Z","thread":{"revision":"basis-revision","range":"empty","offset":0,"length":0},"requestCount":2,"requestCoverage":"complete"},"coverage":{"inputs":"complete","limit":64},"stats":{"work":{"total":{"started":1,"completed":0,"current":{"queued":0,"running":0,"blocked":1}}}}}}}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-session-turn")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	if detail.Run.RootPrimitive != "session.turn" || detail.Run.Status != "blocked" {
		t.Fatalf("run terminal = %s/%s, want session.turn/blocked", detail.Run.RootPrimitive, detail.Run.Status)
	}
	var attributes map[string]any
	if err := json.Unmarshal(detail.Run.Attributes, &attributes); err != nil {
		t.Fatalf("decode attributes: %v", err)
	}
	session, ok := attributes["session"].(map[string]any)
	if !ok {
		t.Fatalf("session projection = %#v", attributes["session"])
	}
	checkpoint, ok := session["checkpoint"].(map[string]any)
	if !ok || checkpoint["requestCount"] != float64(2) {
		t.Fatalf("checkpoint projection = %#v", session["checkpoint"])
	}
	serialized, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal run detail: %v", err)
	}
	for _, forbidden := range []string{"\"requestIds\"", "\"reasoning\"", "\"credentials\"", "\"inputPayload\"", "\"outputPayload\"", "\"toolArguments\""} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("run detail contains forbidden field %q", forbidden)
		}
	}
}
