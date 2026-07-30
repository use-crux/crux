package eventwire

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextDiagnosticEvidenceRoundTripsEveryCause(t *testing.T) {
	fixtures := []string{
		`{"kind":"prompt-text","sourceRefId":"ref:invalid","interpolationIndex":1,"interpolationPath":[0,2],"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["boolean","object"]}}`,
		`{"kind":"prompt-text","sourceRefId":"ref:sequence","interpolationIndex":0,"proof":"syntax-exact","cause":{"kind":"inline-sequence","joinableWithComma":true}}`,
		`{"kind":"prompt-text","sourceRefId":"ref:json","interpolationIndex":2,"proof":"semantic-exact","cause":{"kind":"json-serialization","reason":"undefined-result"}}`,
	}
	for _, fixture := range fixtures {
		var evidence store.PromptTextDiagnosticEvidence
		if err := json.Unmarshal([]byte(fixture), &evidence); err != nil {
			t.Fatalf("Unmarshal(%s) error = %v", fixture, err)
		}
		encoded, err := json.Marshal(evidence)
		if err != nil {
			t.Fatalf("Marshal(%s) error = %v", fixture, err)
		}
		var roundTrip store.PromptTextDiagnosticEvidence
		if err := json.Unmarshal(encoded, &roundTrip); err != nil {
			t.Fatalf("round-trip Unmarshal(%s) error = %v", encoded, err)
		}
		if roundTrip.SourceRefID != evidence.SourceRefID ||
			roundTrip.Cause.Kind != evidence.Cause.Kind {
			t.Fatalf("round trip = %#v, want %#v", roundTrip, evidence)
		}
	}
}

func TestPromptTextDiagnosticEvidenceRejectsNoncanonicalWireShapes(t *testing.T) {
	fixtures := []string{
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","extra":true,"cause":{"kind":"inline-sequence"}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"inline-sequence","extra":true}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["object","boolean"]}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["object"],"mdJsonApplicable":true}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"inline-sequence","joinableWithComma":false}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"inline-sequence","joinableWithComma":null}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"inline-sequence","runtimeKinds":null}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["boolean"],"mdJsonApplicable":null}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"interpolationPath":[],"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["boolean"]}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"interpolationPath":null,"proof":"semantic-exact","cause":{"kind":"invalid-interpolation","runtimeKinds":["boolean"]}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":2147483648,"proof":"semantic-exact","cause":{"kind":"inline-sequence"}}`,
		`{"kind":"prompt-text","sourceRefId":"ref","interpolationIndex":0,"proof":"semantic-exact","cause":{"kind":"json-serialization","reason":"other"}}`,
	}
	for _, fixture := range fixtures {
		var evidence store.PromptTextDiagnosticEvidence
		err := json.Unmarshal([]byte(fixture), &evidence)
		if err == nil {
			t.Fatalf("Unmarshal(%s) succeeded, want strict rejection", fixture)
		}
		if !strings.Contains(err.Error(), "PromptText") &&
			!strings.Contains(err.Error(), "unknown field") {
			t.Fatalf("Unmarshal(%s) error = %v, want bounded evidence error", fixture, err)
		}
	}
}

func TestIndexDiagnosticRejectsNullPromptTextEvidence(t *testing.T) {
	t.Parallel()

	var diagnostic store.IndexDiagnostic
	err := json.Unmarshal([]byte(
		`{"id":"diagnostic","severity":"error","code":"test","message":"test","evidence":null}`,
	), &diagnostic)
	if err == nil {
		t.Fatal("IndexDiagnostic accepted null evidence")
	}
}
