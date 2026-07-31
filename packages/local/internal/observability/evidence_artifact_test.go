package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidenceSourceArtifactRequiresExactProtectedMarker(t *testing.T) {
	valid := evidenceSourceArtifactTestRecord(t)
	if err := ValidateRecord(valid); err != nil {
		t.Fatalf("valid evidence source artifact: %v", err)
	}

	var artifact ArtifactRecord
	if err := json.Unmarshal(valid.Payload, &artifact); err != nil {
		t.Fatal(err)
	}
	for name, attributes := range map[string]string{
		"missing capture state": `{
			"evidenceSource":{"evidenceId":"evidence_1111111111111111"}
		}`,
		"invalid evidence id": `{
			"evidenceSource":{
				"evidenceId":"caller-controlled",
				"captureState":"available"
			}
		}`,
		"nested extra field": `{
			"evidenceSource":{
				"evidenceId":"evidence_1111111111111111",
				"captureState":"available",
				"private":true
			}
		}`,
		"top-level extra field": `{
			"evidenceSource":{
				"evidenceId":"evidence_1111111111111111",
				"captureState":"available"
			},
			"private":true
		}`,
	} {
		t.Run(name, func(t *testing.T) {
			candidate := artifact
			candidate.Attributes = json.RawMessage(attributes)
			payload, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			record := valid
			record.Payload = payload
			if err := ValidateRecord(record); err == nil {
				t.Fatalf("expected %s to fail", name)
			}
		})
	}
}

func TestEvidenceSourceArtifactRequiresCanonicalJSONEnvelope(t *testing.T) {
	valid := evidenceSourceArtifactTestRecord(t)
	var artifact ArtifactRecord
	if err := json.Unmarshal(valid.Payload, &artifact); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*ArtifactRecord){
		"content type": func(candidate *ArtifactRecord) {
			candidate.ContentType = "text/plain"
		},
		"encoding": func(candidate *ArtifactRecord) {
			candidate.Encoding = "base64"
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := artifact
			mutate(&candidate)
			payload, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			record := valid
			record.Payload = payload
			if err := ValidateRecord(record); err == nil {
				t.Fatalf("expected invalid evidence source %s", name)
			}
		})
	}
}

func TestEvidenceSourceArtifactEnforcesCaptureStateMatrix(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		state  string
		mutate func(map[string]any)
		valid  bool
	}{
		{
			name:  "available null preview",
			state: "available",
			mutate: func(payload map[string]any) {
				payload["preview"] = nil
			},
			valid: true,
		},
		{
			name:  "available missing preview",
			state: "available",
			mutate: func(payload map[string]any) {
				delete(payload, "preview")
			},
		},
		{
			name:  "reference absent metadata",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
			},
			valid: true,
		},
		{
			name:  "reference zero size",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = "sha256:" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
				payload["sizeBytes"] = 0
			},
			valid: true,
		},
		{
			name:  "reference null preview",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				payload["preview"] = nil
			},
		},
		{
			name:  "reference absent hash",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
			},
			valid: true,
		},
		{
			name:  "reference short hash",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = "sha256:abc"
			},
		},
		{
			name:  "reference uppercase hash",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = "sha256:" +
					"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
					"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			},
		},
		{
			name:  "reference other algorithm",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = "fnv1a:00000000"
			},
		},
		{
			name:  "reference leading whitespace",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = " sha256:" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			},
		},
		{
			name:  "reference non ASCII",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = "sha256:" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaé"
			},
		},
		{
			name:  "reference null hash",
			state: "reference",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["hash"] = nil
			},
		},
		{
			name:  "not captured exact shell",
			state: "not-captured",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
			},
			valid: true,
		},
		{
			name:  "not captured with size",
			state: "not-captured",
			mutate: func(payload map[string]any) {
				payload["encoding"] = "reference"
				delete(payload, "preview")
				payload["sizeBytes"] = 0
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			record := evidenceSourceArtifactTestRecord(t)
			var payload map[string]any
			if err := json.Unmarshal(record.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			attributes := payload["attributes"].(map[string]any)
			marker := attributes["evidenceSource"].(map[string]any)
			marker["captureState"] = testCase.state
			testCase.mutate(payload)
			encoded, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			record.Payload = encoded
			err = ValidateRecord(record)
			if (err == nil) != testCase.valid {
				t.Fatalf("valid = %v, error = %v", testCase.valid, err)
			}
		})
	}
}

func evidenceSourceArtifactTestRecord(t *testing.T) Record {
	t.Helper()
	return mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_evidence_artifact",
		"type":"artifact",
		"operationId":"run_evidence",
		"runId":"run_evidence",
		"segmentId":"seg_evidence",
		"segmentSeq":1,
		"artifactId":"artifact_evidence",
		"kind":"score.report",
		"createdAt":"2026-07-29T12:00:00Z",
		"contentType":"application/json",
		"encoding":"json",
		"preview":{"policyUrl":"https://example.com/p"},
		"attributes":{
			"evidenceSource":{
				"evidenceId":"evidence_1111111111111111",
				"captureState":"available"
			}
		}
	}`)
}
