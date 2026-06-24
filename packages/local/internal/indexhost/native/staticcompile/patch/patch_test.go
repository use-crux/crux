package patch

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectNativeStaticPatchFromFinalizeEventsRejectsMalformedStream(t *testing.T) {
	_, _, usedNativeStatic, err := FromEvents(testOptions(), []json.RawMessage{
		json.RawMessage(`{"protocolVersion":2,"type":"phase:error","transactionId":"native-error","phase":"ast","error":{"message":"native finalize failed"}}`),
	})
	if err == nil {
		t.Fatal("FromEvents error = nil, want malformed finalize stream rejected")
	}
	if !usedNativeStatic {
		t.Fatalf("usedNativeStatic = false, want true for malformed native finalize stream")
	}
	if !strings.Contains(err.Error(), "native finalize failed") {
		t.Fatalf("error = %v, want native finalize failure", err)
	}
}

func TestProjectNativeStaticPatchFromFinalizeEventsRejectsIncompleteStream(t *testing.T) {
	_, _, usedNativeStatic, err := FromEvents(testOptions(), []json.RawMessage{
		json.RawMessage(`{"protocolVersion":2,"type":"phase:start","transactionId":"native-incomplete","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}`),
	})
	if err == nil {
		t.Fatal("FromEvents error = nil, want incomplete finalize stream rejected")
	}
	if !usedNativeStatic {
		t.Fatalf("usedNativeStatic = false, want true for incomplete native finalize stream")
	}
	if !strings.Contains(err.Error(), "did not complete") {
		t.Fatalf("error = %v, want incomplete transaction failure", err)
	}
}

func TestProjectNativeStaticPatchFromFinalizeEventsFallsBackWithoutCompleteDecision(t *testing.T) {
	_, _, usedNativeStatic, err := FromEvents(testOptions(), []json.RawMessage{
		json.RawMessage(`{"protocolVersion":2,"type":"phase:start","transactionId":"native-not-ready","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}`),
		json.RawMessage(`{"protocolVersion":2,"type":"phase:done","transactionId":"native-not-ready","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo"},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok","invalidates":{"all":true}},"summary":{"factCount":0}}`),
	})
	if err != nil {
		t.Fatalf("FromEvents error = %v, want nil fallback", err)
	}
	if usedNativeStatic {
		t.Fatalf("usedNativeStatic = true, want fallback until nativeStaticComplete decision is true")
	}
}

func testOptions() Options {
	return Options{
		Root:             "/repo",
		MaxBytes:         16 * 1024 * 1024,
		MaxFactsPerBatch: 200,
		Producer:         "@crux/indexer/project-indexer",
	}
}
