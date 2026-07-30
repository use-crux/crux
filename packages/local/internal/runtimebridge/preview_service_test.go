package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func TestPreviewDispatchSelectsExactlyAndValidatesResponse(t *testing.T) {
	service := NewService(nil)
	sent := make(chan struct {
		request CommandRequest
		data    []byte
	}, 1)
	service.RegisterPeer(previewPeer(t, "peer-b", 4, "prompt:greeting"), func(_ context.Context, data []byte) error {
		var request CommandRequest
		if err := json.Unmarshal(data, &request); err != nil {
			return err
		}
		sent <- struct {
			request CommandRequest
			data    []byte
		}{request: request, data: append([]byte(nil), data...)}
		return nil
	})

	done := make(chan struct {
		response DispatchResponse
		err      error
	}, 1)
	go func() {
		response, err := service.Dispatch(context.Background(), DispatchRequest{
			PeerID: "peer-b", Environment: "node", Command: preview.Command,
			TargetID: "prompt:greeting", CatalogueRevision: 4,
			Payload: json.RawMessage(`{"input":{}}`), DeadlineMS: 1_000,
		})
		done <- struct {
			response DispatchResponse
			err      error
		}{response, err}
	}()

	emitted := <-sent
	request := emitted.request
	canonical, err := encodePreviewCommand(request)
	if err != nil || !bytes.Equal(emitted.data, canonical) {
		t.Fatalf("emitted request is not canonical: %q, %v", emitted.data, err)
	}
	response := `{"type":"command.result","commandId":"` + request.CommandID + `","result":{
		"status":"ready","targetId":"prompt:greeting","catalogueRevision":4,
		"inspection":{"system":{"text":"","tokens":0,"coverage":"complete","parts":[]},
		"totalTokens":0,"droppedContexts":[],"excludedContexts":[]}}}`
	if err := service.HandlePeerMessage("peer-b", []byte(response)); err != nil {
		t.Fatalf("HandlePeerMessage: %v", err)
	}
	out := <-done
	if out.err != nil || out.response.PeerID != "peer-b" {
		t.Fatalf("Dispatch = %#v, %v", out.response, out.err)
	}
}

func TestPreviewManifestReplacementRetiresOnlyPreview(t *testing.T) {
	service := NewService(nil)
	sent := make(chan CommandRequest, 1)
	peer := previewPeer(t, "peer", 1, "prompt:x")
	service.RegisterPeer(peer, func(_ context.Context, data []byte) error {
		var request CommandRequest
		if err := json.Unmarshal(data, &request); err == nil && request.Type == "command.request" {
			sent <- request
		}
		return nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(ctx, DispatchRequest{
			Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
			Payload: json.RawMessage(`{"input":{}}`),
		})
		done <- err
	}()
	<-sent
	peer.Capabilities = nil
	if err := service.ReplacePeerManifest("peer", peer); err != nil {
		t.Fatalf("ReplacePeerManifest: %v", err)
	}
	if err := <-done; !preview.IsFailure(err, "target_disappeared") {
		t.Fatalf("Dispatch error = %v", err)
	}
}

func TestPreviewCapabilityRemainsPrivateToSelection(t *testing.T) {
	service := NewService(nil)
	registered := service.RegisterPeer(previewPeer(t, "private", 2, "prompt:secret"), nil)
	if hasPreviewCapability(registered.Capabilities) {
		t.Fatal("RegisterPeer returned private preview capability")
	}
	peers := service.Peers()
	if len(peers) != 1 || hasPreviewCapability(peers[0].Capabilities) {
		t.Fatalf("Peers exposed private capability: %#v", peers)
	}
	if _, err := service.selectPreviewPeer(DispatchRequest{
		Command: preview.Command, TargetID: "prompt:secret", CatalogueRevision: 2,
	}); err != nil {
		t.Fatalf("private selection state was not retained: %v", err)
	}
}

func TestPreviewNoneInputRejectsFieldsBeforeSend(t *testing.T) {
	service := NewService(nil)
	service.RegisterPeer(
		previewPeer(t, "none-input", 1, "prompt:none"),
		func(context.Context, []byte) error {
			t.Fatal("invalid none-input request reached the runtime")
			return nil
		},
	)

	_, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: preview.Command, TargetID: "prompt:none",
		CatalogueRevision: 1,
		Payload:           json.RawMessage(`{"input":{"unexpected":true}}`),
	})
	if !preview.IsFailure(err, "invalid_request") {
		t.Fatalf("Dispatch error = %v, want invalid_request", err)
	}
}

func TestSameIDReconnectRetiresOldConnectionOnly(t *testing.T) {
	service := NewService(nil)
	oldSent := make(chan CommandRequest, 1)
	peer := previewPeer(t, "same", 1, "prompt:x")
	_, oldConnection := service.RegisterPeerConnection(peer, func(_ context.Context, data []byte) error {
		var request CommandRequest
		if json.Unmarshal(data, &request) == nil && request.Type == "command.request" {
			oldSent <- request
		}
		return nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(context.Background(), DispatchRequest{
			Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
			Payload: json.RawMessage(`{"input":{}}`),
		})
		done <- err
	}()
	<-oldSent

	_, newConnection := service.RegisterPeerConnection(peer, nil)
	if err := <-done; !preview.IsFailure(err, "target_disappeared") {
		t.Fatalf("old Dispatch error = %v", err)
	}
	service.UnregisterPeerConnection("same", oldConnection)
	if len(service.Peers()) != 1 {
		t.Fatal("old disconnect removed replacement")
	}
	service.UnregisterPeerConnection("same", newConnection)
	if len(service.Peers()) != 0 {
		t.Fatal("replacement disconnect did not remove peer")
	}
}

func TestStoreDisconnectStillReturnsErrNoPeer(t *testing.T) {
	service := NewService(nil)
	sent := make(chan CommandRequest, 1)
	service.RegisterPeer(Peer{
		PeerID: "store", Transport: TransportWS,
		Capabilities: []Capability{{Command: "store.read"}},
	}, func(_ context.Context, data []byte) error {
		var request CommandRequest
		_ = json.Unmarshal(data, &request)
		sent <- request
		return nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(context.Background(), DispatchRequest{
			Command: "store.read",
			Payload: json.RawMessage(`{"operation":"get","resource":"crux.store","key":"x"}`),
		})
		done <- err
	}()
	<-sent
	service.UnregisterPeer("store")
	if err := <-done; err != ErrNoPeer {
		t.Fatalf("store disconnect error = %v, want ErrNoPeer", err)
	}
}

func TestPreviewDisconnectAfterSelectionKeepsItsStableFailure(t *testing.T) {
	service := NewService(nil)
	peer := previewPeer(t, "peer-disconnect", 1, "prompt:x")
	service.RegisterPeer(peer, func(context.Context, []byte) error {
		t.Fatal("disconnected peer must not receive a command")
		return nil
	})
	selected, err := service.selectPreviewPeer(DispatchRequest{
		Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	service.UnregisterPeer(peer.PeerID)

	_, err = service.dispatchPreviewWS(context.Background(), selected, CommandRequest{
		Type: "command.request", CommandID: "cmd-disconnected",
		Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
		Payload: json.RawMessage(`{"input":{}}`), DeadlineMS: 1000,
	})
	if !preview.IsFailure(err, "peer_disconnected") {
		t.Fatalf("failure = %v, want peer_disconnected", err)
	}
}

func TestPreviewWebSocketCancellationDiscardsLateResponse(t *testing.T) {
	service := NewService(nil)
	requests := make(chan CommandRequest, 1)
	cancellations := make(chan map[string]string, 1)
	service.RegisterPeer(
		previewPeer(t, "peer-cancel", 1, "prompt:x"),
		func(_ context.Context, data []byte) error {
			var envelope CommandEnvelope
			_ = json.Unmarshal(data, &envelope)
			switch envelope.Type {
			case "command.request":
				var request CommandRequest
				_ = json.Unmarshal(data, &request)
				requests <- request
			case "command.cancel":
				var cancellation map[string]string
				_ = json.Unmarshal(data, &cancellation)
				cancellations <- cancellation
			}
			return nil
		},
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(ctx, DispatchRequest{
			Command: preview.Command, TargetID: "prompt:x",
			CatalogueRevision: 1, Payload: json.RawMessage(`{"input":{}}`),
		})
		done <- err
	}()
	request := <-requests
	cancel()
	if err := <-done; !preview.IsFailure(err, "cancelled") {
		t.Fatalf("Dispatch error = %v", err)
	}
	cancellation := <-cancellations
	if cancellation["commandId"] != request.CommandID ||
		cancellation["reason"] != "cancelled" {
		t.Fatalf("cancellation = %#v", cancellation)
	}

	late := `{"type":"command.result","commandId":"` + request.CommandID + `","result":{
		"status":"ready","targetId":"prompt:x","catalogueRevision":1,
		"inspection":{"system":{"text":"","tokens":0,"coverage":"complete","parts":[]},
		"totalTokens":0,"droppedContexts":[],"excludedContexts":[]}}}`
	if err := service.HandlePeerMessage("peer-cancel", []byte(late)); err != nil {
		t.Fatalf("late response changed command state: %v", err)
	}
}

func hasPreviewCapability(capabilities []Capability) bool {
	for _, capability := range capabilities {
		if capability.Command == preview.Command {
			return true
		}
	}
	return false
}

func previewPeer(t *testing.T, peerID string, revision uint64, target string) Peer {
	t.Helper()
	raw := []byte(`{"command":"prompt.previewExact","catalogueRevision":` +
		jsonNumber(revision) + `,"targets":[{"definitionId":"` + target +
		`","kind":"prompt","name":"target","input":{"mode":"none"}}]}`)
	var capability Capability
	if err := json.Unmarshal(raw, &capability); err != nil {
		t.Fatalf("decode capability: %v", err)
	}
	return Peer{
		PeerID: peerID, RuntimeName: peerID, Environment: "node",
		Transport: TransportWS, Capabilities: []Capability{capability},
	}
}

func jsonNumber(value uint64) string {
	data, _ := json.Marshal(value)
	return string(data)
}
