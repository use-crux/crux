package preview

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeCapabilityStrictAndSorted(t *testing.T) {
	capability, err := DecodeCapability([]byte(`{
		"command":"prompt.previewExact",
		"catalogueRevision":7,
		"targets":[
			{"definitionId":"prompt:z","kind":"prompt","name":"z","input":{"mode":"none"}},
			{"definitionId":"prompt:a","kind":"prompt","name":"a","input":{"mode":"raw"}}
		]
	}`))
	if err != nil {
		t.Fatalf("DecodeCapability: %v", err)
	}
	if got := capability.Targets[0].DefinitionID; got != "prompt:a" {
		t.Fatalf("first target = %q", got)
	}

	for _, raw := range []string{
		`{"command":"prompt.previewExact","catalogueRevision":7,"targets":[],"extra":true}`,
		`{"command":"prompt.previewExact","catalogueRevision":7,"targets":[{"definitionId":"prompt:a","kind":"prompt","name":"a","input":{"mode":"none","extra":true}}]}`,
		`{"command":"prompt.previewExact","catalogueRevision":7,"catalogueRevision":8,"targets":[{"definitionId":"prompt:a","kind":"prompt","name":"a","input":{"mode":"none"}}]}`,
	} {
		if _, err := DecodeCapability([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid capability: %s", raw)
		}
	}
}

func TestSelectUsesExactPrecedenceAndSortedAmbiguity(t *testing.T) {
	peers := []Candidate{
		{PeerID: "peer-z", RuntimeName: "z", Environment: "node", Capability: capability(1, "prompt:x")},
		{PeerID: "peer-a", RuntimeName: "a", Environment: "node", Capability: capability(1, "prompt:x")},
	}
	_, err := Select(peers, "", "", "prompt:x", 1)
	var failure *Failure
	if !AsFailure(err, &failure) || failure.Code != "ambiguous_peer" {
		t.Fatalf("Select error = %#v", err)
	}
	if failure.Choices[0].PeerID != "peer-a" || failure.Choices[1].PeerID != "peer-z" {
		t.Fatalf("choices = %#v", failure.Choices)
	}

	_, err = Select(peers, "", "convex", "prompt:x", 1)
	if !IsFailure(err, "environment_unavailable") {
		t.Fatalf("environment error = %v", err)
	}
	_, err = Select(peers, "", "node", "prompt:missing", 1)
	if !IsFailure(err, "target_unavailable") {
		t.Fatalf("target error = %v", err)
	}
	_, err = Select(peers, "", "node", "prompt:x", 2)
	if !IsFailure(err, "catalogue_changed") {
		t.Fatalf("revision error = %v", err)
	}
}

func TestSelectCoversEveryZeroMatchStageAndExplicitPeer(t *testing.T) {
	supported := capability(1, "prompt:x")
	withoutCapability := []Candidate{{
		PeerID: "peer-a", RuntimeName: "a", Environment: "node",
	}}
	for _, test := range []struct {
		name        string
		candidates  []Candidate
		peerID      string
		environment string
		targetID    string
		revision    uint64
		code        string
	}{
		{name: "no live peer", targetID: "prompt:x", revision: 1, code: "no_peer"},
		{
			name: "explicit peer absent", candidates: withoutCapability,
			peerID: "missing", targetID: "prompt:x", revision: 1, code: "no_peer",
		},
		{
			name: "environment absent", candidates: withoutCapability,
			environment: "convex", targetID: "prompt:x", revision: 1,
			code: "environment_unavailable",
		},
		{
			name: "capability absent", candidates: withoutCapability,
			targetID: "prompt:x", revision: 1, code: "capability_unavailable",
		},
		{
			name: "target absent", candidates: []Candidate{{
				PeerID: "peer-a", RuntimeName: "a", Environment: "node",
				Capability: supported,
			}},
			targetID: "prompt:missing", revision: 1, code: "target_unavailable",
		},
		{
			name: "revision absent", candidates: []Candidate{{
				PeerID: "peer-a", RuntimeName: "a", Environment: "node",
				Capability: supported,
			}},
			targetID: "prompt:x", revision: 2, code: "catalogue_changed",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := Select(
				test.candidates, test.peerID, test.environment,
				test.targetID, test.revision,
			)
			if !IsFailure(err, test.code) {
				t.Fatalf("Select error = %v, want %s", err, test.code)
			}
		})
	}

	selected, err := Select([]Candidate{
		{PeerID: "peer-b", RuntimeName: "b", Environment: "node", Capability: supported},
		{PeerID: "peer-a", RuntimeName: "a", Environment: "node", Capability: supported},
	}, "peer-b", "", "prompt:x", 1)
	if err != nil || selected.PeerID != "peer-b" {
		t.Fatalf("explicit Select = %#v, %v", selected, err)
	}
}

func TestDecodeResponseRejectsForeignFieldsAndRunIDs(t *testing.T) {
	result := `{"type":"command.result","commandId":"cmd","result":{
		"status":"ready","targetId":"prompt:x","catalogueRevision":1,
		"inspection":{"system":{"text":"","tokens":0,"coverage":"complete","parts":[]},
		"totalTokens":0,"droppedContexts":[],"excludedContexts":[]}
	}}`
	if _, err := DecodeResponse([]byte(result), "cmd", "prompt:x", 1); err != nil {
		t.Fatalf("DecodeResponse: %v", err)
	}
	var envelope map[string]any
	_ = json.Unmarshal([]byte(result), &envelope)
	envelope["runIds"] = []string{}
	withRuns, _ := json.Marshal(envelope)
	if _, err := DecodeResponse(withRuns, "cmd", "prompt:x", 1); !IsFailure(err, "invalid_response") {
		t.Fatalf("runIds error = %v", err)
	}
}

func TestRuntimeFailureUsesStableLocalCategories(t *testing.T) {
	for runtimeCode, localCode := range map[string]string{
		"inspection_timeout": "deadline_exceeded",
		"target_retired":     "target_disappeared",
		"inspection_failed":  "command_failed",
	} {
		if failure := RuntimeFailure(&ErrorBody{Code: runtimeCode}); failure.Code != localCode {
			t.Fatalf("RuntimeFailure(%q) = %q", runtimeCode, failure.Code)
		}
	}
}

func TestValidateDispatchRejectsNullOptionalsAndUnsafeRevision(t *testing.T) {
	for _, test := range []struct {
		name     string
		revision uint64
		payload  string
	}{
		{name: "provider null", revision: 1, payload: `{"input":{},"options":{"provider":null}}`},
		{name: "model null", revision: 1, payload: `{"input":{},"options":{"modelId":null}}`},
		{name: "budget null", revision: 1, payload: `{"input":{},"options":{"tokenBudget":null}}`},
		{name: "unsafe revision", revision: 9_007_199_254_740_992, payload: `{"input":{}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateDispatch("prompt:x", "node", test.revision, []byte(test.payload), 1_000); err == nil {
				t.Fatal("ValidateDispatch accepted invalid request")
			}
		})
	}
}

func TestDecodeResponseUsesUTF16BoundsAndRejectsExplicitEmptyOptionals(t *testing.T) {
	source := strings.Repeat("é", 512)
	valid := `{"type":"command.result","commandId":"cmd","result":{
		"status":"ready","targetId":"prompt:x","catalogueRevision":1,
		"inspection":{"system":{"text":"x","tokens":1,"coverage":"complete","parts":[{
			"source":"prompt","text":"x","tokens":1,"skipped":false,
			"segments":[{"kind":"static","startUtf16":0,"endUtf16":1,"source":"` + source + `"}]
		}]},"totalTokens":1,"droppedContexts":[],"excludedContexts":[]}
	}}`
	if _, err := DecodeResponse([]byte(valid), "cmd", "prompt:x", 1); err != nil {
		t.Fatalf("DecodeResponse rejected UTF-16-bounded source: %v", err)
	}

	for _, invalid := range []string{
		strings.Replace(valid, `"source":"`+source+`"`, `"source":""`, 1),
		`{"type":"command.error","commandId":"cmd","error":{
			"code":"inspection_failed","message":"failed","details":{"targetId":""}
		}}`,
	} {
		if _, err := DecodeResponse([]byte(invalid), "cmd", "prompt:x", 1); !IsFailure(err, "invalid_response") {
			t.Fatalf("DecodeResponse accepted explicit empty optional: %s", invalid)
		}
	}
}

func capability(revision uint64, target string) *Capability {
	return &Capability{
		Command: Command, CatalogueRevision: revision,
		Targets: []Target{{
			DefinitionID: target, Kind: "prompt", Name: target,
			Input: InputDescriptor{Mode: "none"},
		}},
	}
}

func AsFailure(err error, target **Failure) bool {
	failure, ok := err.(*Failure)
	if ok {
		*target = failure
	}
	return ok
}
