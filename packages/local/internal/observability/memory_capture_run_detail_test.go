package observability

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestMemoryCaptureRunDetailRoundTrip(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"recordId":"memory-run-start","type":"run:start","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":1,"name":"memory capture","rootPrimitive":"generation.call","startedAt":"2026-07-21T10:00:00.000Z","status":"running"}`,
		`{"recordId":"memory-generation-start","type":"span:start","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":2,"spanId":"span-generation","parentSpanId":null,"family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-07-21T10:00:00.010Z","status":"running"}`,
		`{"recordId":"memory-capture-start","type":"span:start","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":3,"spanId":"span-memory-capture","parentSpanId":"span-generation","family":"memory","primitive":"memory.capture","name":"memory.capture","startedAt":"2026-07-21T10:00:00.020Z","status":"running","attributes":{"memoryId":"conversation","operation":"turn","requestedMode":"deferred","sequence":1,"blockCount":1,"toolEventCount":0},"definitionRefs":[{"id":"memory:conversation","kind":"memory","role":"invoked-memory"}]}`,
		`{"recordId":"memory-write-start","type":"span:start","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":4,"spanId":"span-memory-write","parentSpanId":"span-memory-capture","family":"memory","primitive":"memory.write","name":"recent.addTurn","startedAt":"2026-07-21T10:00:00.030Z","status":"running","attributes":{"memoryId":"conversation","operation":"addTurn"}}`,
		`{"recordId":"memory-write-end","type":"span:end","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":5,"spanId":"span-memory-write","endedAt":"2026-07-21T10:00:00.040Z","durationMs":10,"status":"ok"}`,
		`{"recordId":"memory-capture-end","type":"span:end","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":6,"spanId":"span-memory-capture","endedAt":"2026-07-21T10:00:00.050Z","durationMs":30,"status":"ok","attributes":{"memoryId":"conversation","operation":"turn","requestedMode":"deferred","disposition":"retained","sequence":1,"blockCount":1,"toolEventCount":0,"outcome":"completed"}}`,
		`{"recordId":"memory-generation-end","type":"span:end","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":7,"spanId":"span-generation","endedAt":"2026-07-21T10:00:00.060Z","durationMs":50,"status":"ok"}`,
		`{"recordId":"memory-run-end","type":"run:end","runId":"run-memory-capture","segmentId":"seg-memory-capture","segmentSeq":8,"endedAt":"2026-07-21T10:00:00.070Z","durationMs":70,"status":"ok"}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-memory-capture")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	capture := findRunDetailNode(&detail.Root, "span-memory-capture")
	if capture == nil {
		t.Fatal("memory.capture span missing from run detail")
	}
	if capture.Primitive != "memory.capture" || capture.Status != "ok" || capture.DurationMs != 30 {
		t.Fatalf("capture lifecycle = primitive:%q status:%q duration:%v", capture.Primitive, capture.Status, capture.DurationMs)
	}
	if capture.ParentSpanID != "span-generation" {
		t.Fatalf("capture parent = %q, want span-generation", capture.ParentSpanID)
	}
	if capture.Display.Kind != "memory" || capture.Display.Label != "Memory capture · conversation" {
		t.Fatalf("capture display = %+v", capture.Display)
	}
	wantRefs := []DefinitionRef{{ID: "memory:conversation", Kind: "memory", Role: "invoked-memory"}}
	if !reflect.DeepEqual(capture.DefinitionRefs, wantRefs) {
		t.Fatalf("capture definition refs = %+v, want %+v", capture.DefinitionRefs, wantRefs)
	}
	var attributes map[string]any
	if err := json.Unmarshal(capture.Attributes, &attributes); err != nil {
		t.Fatalf("capture attributes: %v", err)
	}
	if attributes["memoryId"] != "conversation" || attributes["disposition"] != "retained" || attributes["outcome"] != "completed" {
		t.Fatalf("capture attributes = %#v", attributes)
	}
	var write *RunDetailDetail
	for index := range capture.Details {
		if capture.Details[index].SpanID == "span-memory-write" {
			write = &capture.Details[index]
			break
		}
	}
	if write == nil || write.ParentSpanID != capture.SpanID || write.Primitive != "memory.write" {
		t.Fatalf("memory.write child detail = %+v", write)
	}
}
