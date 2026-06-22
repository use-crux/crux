package server

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestDecodeProjectSyntaxWorkerBatchRecordEventPreservesRecordJSON(t *testing.T) {
	raw := json.RawMessage(`{"id":7,"type":"record","index":2,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/a.ts","matches":[{"kind":"call","args":[{"kind":"literal","value":"brace } in string"}]}],"localInitializers":[],"diagnostics":[]}}`)

	event, err := decodeProjectSyntaxWorkerBatchEvent(raw)
	if err != nil {
		t.Fatalf("decodeProjectSyntaxWorkerBatchEvent error = %v", err)
	}

	if event.ID != 7 || event.Type != "record" || event.Index != 2 {
		t.Fatalf("event = %#v, want record id=7 index=2", event)
	}
	wantRecord := json.RawMessage(`{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/a.ts","matches":[{"kind":"call","args":[{"kind":"literal","value":"brace } in string"}]}],"localInitializers":[],"diagnostics":[]}`)
	if !bytes.Equal(event.Record, wantRecord) {
		t.Fatalf("record = %s, want %s", event.Record, wantRecord)
	}
}

func TestDecodeProjectSyntaxWorkerBatchTerminalEvents(t *testing.T) {
	done, err := decodeProjectSyntaxWorkerBatchEvent(json.RawMessage(`{"id":9,"type":"done","count":3}`))
	if err != nil {
		t.Fatalf("decode done error = %v", err)
	}
	if done.ID != 9 || done.Type != "done" || done.Count != 3 {
		t.Fatalf("done event = %#v, want id=9 count=3", done)
	}

	failed, err := decodeProjectSyntaxWorkerBatchEvent(json.RawMessage(`{"id":10,"type":"error","error":"missing source"}`))
	if err != nil {
		t.Fatalf("decode error event error = %v", err)
	}
	if failed.ID != 10 || failed.Type != "error" || failed.Error != "missing source" {
		t.Fatalf("error event = %#v, want id=10 message", failed)
	}
}
