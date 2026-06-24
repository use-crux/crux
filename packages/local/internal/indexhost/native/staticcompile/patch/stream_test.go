package patch

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/protocol"
)

func TestFromFinalizeStreamSetsStreamAndCollectsPatch(t *testing.T) {
	streamer := &recordingFinalizeStreamer{events: completePatchEvents("/repo")}

	patch, _, complete, response, err := FromFinalizeStream(context.Background(), testOptions(), streamer, protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
	})

	if err != nil {
		t.Fatalf("FromFinalizeStream error = %v", err)
	}
	if !complete {
		t.Fatal("complete = false, want complete native stream")
	}
	if !streamer.stream {
		t.Fatal("request stream flag = false, want true")
	}
	if response.Method != protocol.FinalizeMethod {
		t.Fatalf("response method = %q, want finalize method", response.Method)
	}
	if patch.Project.Root != "/repo" {
		t.Fatalf("patch root = %q, want /repo", patch.Project.Root)
	}
}

func TestFromCompileStreamSetsStreamAndCollectsPatch(t *testing.T) {
	streamer := &recordingCompileStreamer{events: completePatchEvents("/repo")}

	patch, _, complete, response, err := FromCompileStream(context.Background(), testOptions(), streamer, protocol.CompileRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.CompileMethod,
	})

	if err != nil {
		t.Fatalf("FromCompileStream error = %v", err)
	}
	if !complete {
		t.Fatal("complete = false, want complete native stream")
	}
	if !streamer.stream {
		t.Fatal("request stream flag = false, want true")
	}
	if response.Method != protocol.CompileMethod {
		t.Fatalf("response method = %q, want compile method", response.Method)
	}
	if patch.Project.Root != "/repo" {
		t.Fatalf("patch root = %q, want /repo", patch.Project.Root)
	}
}

type recordingFinalizeStreamer struct {
	stream bool
	events []json.RawMessage
}

func (s *recordingFinalizeStreamer) NativeStaticFinalizeStream(_ context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	s.stream = request.Stream
	return emitPatchEvents(request.Method, s.events, handle)
}

type recordingCompileStreamer struct {
	stream bool
	events []json.RawMessage
}

func (s *recordingCompileStreamer) NativeStaticCompileStream(_ context.Context, request protocol.CompileRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	s.stream = request.Stream
	return emitPatchEvents(request.Method, s.events, handle)
}

func emitPatchEvents(method string, events []json.RawMessage, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	for _, event := range events {
		if err := handle(protocol.FinalizeStreamEvent{OK: true, Type: "event", Event: event}); err != nil {
			return protocol.FinalizeResponse{}, err
		}
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          method,
		Events:          events,
	}, nil
}

func completePatchEvents(root string) []json.RawMessage {
	return []json.RawMessage{
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:start","transactionId":"tx","phase":"ast","root":%q,"startedAt":"1970-01-01T00:00:00.000Z"}`, root)),
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:done","transactionId":"tx","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":%q},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok","invalidates":{"all":true}},"summary":{"factCount":0,"decision":{"nativeStaticComplete":true}}}`, root)),
	}
}
