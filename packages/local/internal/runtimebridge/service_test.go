package runtimebridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeEvalRunner struct {
	request EvalRunRequest
}

func (f *fakeEvalRunner) RunEval(_ context.Context, req EvalRunRequest) (EvalRunResult, error) {
	f.request = req
	return EvalRunResult{
		Summary:       json.RawMessage(`{"totalPassed":1,"totalFailed":0}`),
		ExperimentIDs: []string{"experiment-1"},
		TraceIDs:      []string{"trace-1"},
	}, nil
}

type failingEvalRunner struct{}

func (f failingEvalRunner) RunEval(_ context.Context, _ EvalRunRequest) (EvalRunResult, error) {
	return EvalRunResult{}, NewCommandExecutionError(
		"eval_runner_error",
		"eval runner exploded",
		json.RawMessage(`{"thrown":"error","phase":"eval_runner.main","summary":{"message":"eval runner exploded","name":"Error"}}`),
		errors.New("eval runner exploded"),
	)
}

func TestServiceRegistersPeerAndPublishesEvent(t *testing.T) {
	svc := NewService(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := svc.Subscribe(ctx)

	peer := svc.RegisterPeer(Peer{
		PeerID:      "peer_1",
		RuntimeName: "local",
		Transport:   TransportWS,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, nil)

	if peer.PeerID != "peer_1" {
		t.Fatalf("peer id = %q", peer.PeerID)
	}
	if got := len(svc.Peers()); got != 1 {
		t.Fatalf("peer count = %d", got)
	}
	select {
	case event := <-events:
		if event.Action != "peer.connected" || event.PeerID != "peer_1" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for peer event")
	}
}

func TestServiceDispatchesWebSocketCommand(t *testing.T) {
	svc := NewService(nil)
	sent := make(chan CommandRequest, 1)
	svc.RegisterPeer(Peer{
		PeerID:    "peer_ws",
		Transport: TransportWS,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, func(_ context.Context, data []byte) error {
		var req CommandRequest
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		sent <- req
		return nil
	})

	done := make(chan DispatchResponse, 1)
	go func() {
		resp, err := svc.Dispatch(context.Background(), DispatchRequest{
			Command: "store.read",
			Payload: json.RawMessage(`{"operation":"get","resource":"crux.store","key":"memory:1"}`),
		})
		if err != nil {
			t.Errorf("dispatch failed: %v", err)
		}
		done <- resp
	}()

	req := <-sent
	if req.Type != "command.request" || req.Command != "store.read" || req.CommandID == "" {
		t.Fatalf("unexpected command request: %#v", req)
	}
	result := CommandResult{
		Type:      "command.result",
		CommandID: req.CommandID,
		Result:    json.RawMessage(`{"value":{"ok":true}}`),
	}
	data, _ := json.Marshal(result)
	if err := svc.HandlePeerMessage("peer_ws", data); err != nil {
		t.Fatalf("handle peer result: %v", err)
	}

	select {
	case resp := <-done:
		if string(resp.Result) != `{"value":{"ok":true}}` {
			t.Fatalf("unexpected result: %s", resp.Result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for dispatch result")
	}
}

func TestServiceDispatchesLocalEvalRun(t *testing.T) {
	runner := &fakeEvalRunner{}
	svc := NewService(nil).WithEvalRunner(runner)

	resp, err := svc.Dispatch(context.Background(), DispatchRequest{
		Command:  "eval.run",
		TargetID: "eval:writer",
		Payload:  json.RawMessage(`{"suiteId":"writer","caseIds":["case-1"],"persist":true}`),
	})
	if err != nil {
		t.Fatalf("dispatch failed: %v", err)
	}
	if resp.PeerID != "local-eval-runner" {
		t.Fatalf("peer id = %q", resp.PeerID)
	}
	if runner.request.TargetID != "eval:writer" || runner.request.SuiteID != "writer" || len(runner.request.CaseIDs) != 1 {
		t.Fatalf("unexpected eval request: %#v", runner.request)
	}
	if string(resp.Result) == "" || len(resp.TraceIDs) != 1 || resp.TraceIDs[0] != "trace-1" {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

func TestServiceDispatchesLocalEvalFailureAsCommandError(t *testing.T) {
	svc := NewService(nil).WithEvalRunner(failingEvalRunner{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := svc.Subscribe(ctx)

	resp, err := svc.Dispatch(context.Background(), DispatchRequest{
		Command: "eval.run",
		Payload: json.RawMessage(`{"suiteId":"writer"}`),
	})
	if err != nil {
		t.Fatalf("dispatch returned transport error: %v", err)
	}
	if resp.PeerID != "local-eval-runner" || resp.Error == nil {
		t.Fatalf("expected local eval command error response, got %#v", resp)
	}
	if resp.Error.Error.Code != "eval_runner_error" || resp.Error.Error.Message != "eval runner exploded" {
		t.Fatalf("unexpected command error: %#v", resp.Error)
	}
	var details map[string]any
	if err := json.Unmarshal(resp.Error.Error.Details, &details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["phase"] != "eval_runner.main" || details["errorKind"] != "eval_runner_error" {
		t.Fatalf("unexpected details: %#v", details)
	}

	var failed *Event
	for i := 0; i < 2; i++ {
		select {
		case event := <-events:
			if event.Action == "command.failed" {
				failed = &event
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for runtime bridge event")
		}
	}
	if failed == nil || failed.Error == nil || failed.Error.Error.Code != "eval_runner_error" {
		t.Fatalf("missing command.failed event with error: %#v", failed)
	}
}

func TestServiceDispatchesHTTPCommand(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Command != "store.read" {
			t.Fatalf("command = %q", req.Command)
		}
		_ = json.NewEncoder(w).Encode(CommandResult{
			Type:      "command.result",
			CommandID: req.CommandID,
			Result:    json.RawMessage(`{"entries":[]}`),
		})
	}))
	defer server.Close()

	svc := NewService(server.Client())
	svc.RegisterPeer(Peer{
		PeerID:      "peer_http",
		Transport:   TransportHTTP,
		EndpointURL: server.URL,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, nil)

	resp, err := svc.Dispatch(context.Background(), DispatchRequest{
		Command: "store.read",
		Payload: json.RawMessage(`{"operation":"list","resource":"crux.store","prefix":"memory:"}`),
	})
	if err != nil {
		t.Fatalf("dispatch failed: %v", err)
	}
	if resp.PeerID != "peer_http" || string(resp.Result) != `{"entries":[]}` {
		t.Fatalf("unexpected response: %#v", resp)
	}
}
