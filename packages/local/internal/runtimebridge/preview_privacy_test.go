package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestPreviewEventsAndLogsExcludeSensitivePayloads(t *testing.T) {
	var logs bytes.Buffer
	service := NewService(nil, WithLogger(slog.New(slog.NewTextHandler(&logs, nil))))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.Subscribe(ctx)
	peer := previewPeer(t, "peer-private", 1, "prompt:secret-target")
	peer.Capabilities[0].Targets[0].Input.Mode = "raw"
	peer.Capabilities[0].raw = nil
	service.RegisterPeer(peer, func(_ context.Context, data []byte) error {
		var request CommandRequest
		if err := json.Unmarshal(data, &request); err != nil ||
			request.Type != "command.request" {
			return err
		}
		result := `{"type":"command.result","commandId":"` + request.CommandID + `","result":{
			"status":"ready","targetId":"prompt:secret-target","catalogueRevision":1,
			"inspection":{"system":{"text":"private-output","tokens":1,"coverage":"complete",
			"parts":[{"source":"private-source","text":"private-output","tokens":1,
			"skipped":false,"segments":[{"kind":"static","startUtf16":0,"endUtf16":14}]}]},
			"totalTokens":1,"droppedContexts":[],"excludedContexts":[]}}}`
		return service.HandlePeerMessage(peer.PeerID, []byte(result))
	})

	response, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: "prompt.previewExact", TargetID: "prompt:secret-target",
		CatalogueRevision: 1,
		Payload:           json.RawMessage(`{"input":{"private-input":"secret"}}`),
	})
	if err != nil || !strings.Contains(string(response.Result), "private-output") {
		t.Fatalf("Dispatch = %#v, %v", response, err)
	}

	collected := []Event{<-events, <-events, <-events}
	encoded, _ := json.Marshal(collected)
	for _, secret := range []string{
		"prompt:secret-target", "private-input", "private-output",
		"private-source",
	} {
		if strings.Contains(string(encoded), secret) ||
			strings.Contains(logs.String(), secret) {
			t.Fatalf("telemetry leaked %q: events=%s logs=%s", secret, encoded, logs.String())
		}
	}
}

func TestPreviewFailureEventKeepsOnlyStableCode(t *testing.T) {
	service := NewService(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.Subscribe(ctx)
	peer := previewPeer(t, "peer-failure", 1, "prompt:x")
	service.RegisterPeer(peer, func(_ context.Context, data []byte) error {
		var request CommandRequest
		if err := json.Unmarshal(data, &request); err != nil ||
			request.Type != "command.request" {
			return err
		}
		result := `{"type":"command.error","commandId":"` + request.CommandID + `",
			"error":{"code":"inspection_failed","message":"private runtime failure"}}`
		return service.HandlePeerMessage(peer.PeerID, []byte(result))
	})

	_, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: "prompt.previewExact", TargetID: "prompt:x",
		CatalogueRevision: 1, Payload: json.RawMessage(`{"input":{}}`),
	})
	if err == nil {
		t.Fatal("Dispatch unexpectedly succeeded")
	}
	connected, sent, failed := <-events, <-events, <-events
	if connected.Action != "peer.connected" || sent.Action != "command.sent" ||
		failed.Action != "command.failed" || failed.Code != "command_failed" ||
		failed.Error != nil {
		t.Fatalf("events = %#v, %#v, %#v", connected, sent, failed)
	}
	encoded, _ := json.Marshal(failed)
	if strings.Contains(string(encoded), "private runtime failure") ||
		strings.Contains(string(encoded), "prompt:x") {
		t.Fatalf("failure event leaked private data: %s", encoded)
	}
}
