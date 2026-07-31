package runtimebridge

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func TestInvalidPreviewGroupRetainsLegacyStoreCapability(t *testing.T) {
	service := NewService(nil)
	peer := previewPeer(t, "mixed", 1, "prompt:x")
	peer.Capabilities = append(
		[]Capability{{Command: "store.read"}},
		peer.Capabilities[0],
		peer.Capabilities[0],
	)
	registered := service.RegisterPeer(peer, nil)

	if hasPreviewCapability(registered.Capabilities) {
		t.Fatal("invalid preview group remained public")
	}
	if _, err := service.selectPeer(DispatchRequest{
		Command: "store.read", PeerID: peer.PeerID,
	}); err != nil {
		t.Fatalf("valid store capability was lost: %v", err)
	}
	if _, err := service.selectPreviewPeer(DispatchRequest{
		Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
	}); !preview.IsFailure(err, "capability_unavailable") {
		t.Fatalf("preview selection error = %v", err)
	}
}

func TestOldConnectionCannotSettleReplacementCommand(t *testing.T) {
	service := NewService(nil)
	peer := previewPeer(t, "same-identity", 1, "prompt:x")
	oldRequests := make(chan CommandRequest, 1)
	_, oldConnection := service.RegisterPeerConnection(
		peer,
		capturePreviewRequest(oldRequests),
	)
	oldDone := dispatchPreviewForTest(service)
	<-oldRequests

	newRequests := make(chan CommandRequest, 1)
	_, newConnection := service.RegisterPeerConnection(
		peer,
		capturePreviewRequest(newRequests),
	)
	if err := <-oldDone; !preview.IsFailure(err, "target_disappeared") {
		t.Fatalf("replaced Dispatch error = %v", err)
	}
	newDone := dispatchPreviewForTest(service)
	request := <-newRequests
	response := readyPreviewResponse(request)

	if err := service.HandlePeerConnectionMessage(
		peer.PeerID, oldConnection, []byte(response),
	); err != ErrNoPeer {
		t.Fatalf("old connection response error = %v, want ErrNoPeer", err)
	}
	select {
	case err := <-newDone:
		t.Fatalf("old connection settled replacement: %v", err)
	default:
	}
	if err := service.HandlePeerConnectionMessage(
		peer.PeerID, newConnection, []byte(response),
	); err != nil {
		t.Fatalf("replacement response error = %v", err)
	}
	if err := <-newDone; err != nil {
		t.Fatalf("replacement Dispatch error = %v", err)
	}
}

func dispatchPreviewForTest(service *Service) <-chan error {
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(context.Background(), DispatchRequest{
			Command: preview.Command, TargetID: "prompt:x",
			CatalogueRevision: 1, Payload: json.RawMessage(`{"input":{}}`),
		})
		done <- err
	}()
	return done
}

func capturePreviewRequest(
	requests chan<- CommandRequest,
) Sender {
	return func(_ context.Context, data []byte) error {
		var request CommandRequest
		if err := json.Unmarshal(data, &request); err == nil &&
			request.Type == "command.request" {
			requests <- request
		}
		return nil
	}
}

func readyPreviewResponse(request CommandRequest) string {
	return `{"type":"command.result","commandId":"` + request.CommandID + `","result":{
		"status":"ready","targetId":"prompt:x","catalogueRevision":1,
		"preview":{"status":"fits","measurement":"exact","adaptations":[],
		"warnings":[],"diagnostics":[]},"contributions":[]}}`
}
