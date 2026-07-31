package observability

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestApprovalArtifactOccurrenceSharedFixture(t *testing.T) {
	var fixture struct {
		Marker             approvalArtifactAttributes `json:"marker"`
		ExpectedArtifactID string                     `json:"expectedArtifactId"`
		Bounds             struct {
			Prefix           string `json:"prefix"`
			MaximumScalars   int    `json:"maximumScalars"`
			MaximumUTF8Bytes int    `json:"maximumUtf8Bytes"`
		} `json:"bounds"`
		ApprovalIDCases []struct {
			Value string `json:"value"`
			Valid bool   `json:"valid"`
		} `json:"approvalIdCases"`
	}
	if err := json.Unmarshal(
		readCoreEvidenceFixture(t, "approval-occurrence-v1.json"),
		&fixture,
	); err != nil {
		t.Fatal(err)
	}

	artifactID, err := approvalArtifactID(fixture.Marker)
	if err != nil {
		t.Fatal(err)
	}
	if artifactID != fixture.ExpectedArtifactID {
		t.Fatalf("artifact id = %q, want %q", artifactID, fixture.ExpectedArtifactID)
	}
	if fixture.Bounds.Prefix != approvalIDPrefix ||
		fixture.Bounds.MaximumScalars != maxApprovalIDScalars ||
		fixture.Bounds.MaximumUTF8Bytes != maxApprovalIDBytes {
		t.Fatalf("approval id bounds drifted: %#v", fixture.Bounds)
	}
	for _, testCase := range fixture.ApprovalIDCases {
		if got := validApprovalID(testCase.Value); got != testCase.Valid {
			t.Errorf("validApprovalID(%q) = %t, want %t", testCase.Value, got, testCase.Valid)
		}
	}
}

func TestApprovalIDV1Boundaries(t *testing.T) {
	validSuffix := strings.Repeat("a", 512-len("approval_"))
	cases := []struct {
		name  string
		value string
		valid bool
	}{
		{name: "maximum scalars", value: "approval_" + validSuffix, valid: true},
		{name: "too many scalars", value: "approval_" + validSuffix + "a"},
		{name: "interior whitespace", value: "approval_a b", valid: true},
		{name: "leading unicode space", value: "approval_\u3000a"},
		{name: "trailing byte order mark", value: "approval_a\ufeff"},
		{name: "control", value: "approval_a\u0085b"},
		{name: "invalid utf8", value: "approval_a" + string([]byte{0xff})},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := validApprovalID(testCase.value); got != testCase.valid {
				t.Fatalf("validApprovalID() = %t, want %t", got, testCase.valid)
			}
		})
	}
}

func TestApprovalArtifactValidation(t *testing.T) {
	marker := approvalArtifactAttributes{
		ApprovalOccurrence: approvalArtifactOccurrence{
			Domain:        "crux.tool.approval",
			IdentityEpoch: 1,
			Namespace: approvalArtifactNamespace{
				OperationID: "run_operation",
				RunID:       "run_request",
			},
			ApprovalID: "approval_call",
			Slot:       "request",
		},
	}
	artifactID, err := approvalArtifactID(marker)
	if err != nil {
		t.Fatal(err)
	}
	attributes, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	artifact := ArtifactRecord{
		OperationID: "run_operation",
		RunID:       "run_request",
		ArtifactID:  artifactID,
		Kind:        "approval.request",
		Attributes:  attributes,
	}
	marked, err := validateApprovalArtifact(artifact)
	if err != nil || !marked {
		t.Fatalf("valid approval artifact: marked=%t err=%v", marked, err)
	}

	for name, mutate := range map[string]func(*ArtifactRecord){
		"kind slot mismatch": func(value *ArtifactRecord) {
			value.Kind = "approval.decision"
		},
		"request namespace mismatch": func(value *ArtifactRecord) {
			value.RunID = "run_other"
		},
		"wrong derived id": func(value *ArtifactRecord) {
			value.ArtifactID = "artifact_" + strings.Repeat("0", 64)
		},
		"unknown marker property": func(value *ArtifactRecord) {
			value.Attributes = append(value.Attributes[:len(value.Attributes)-1], []byte(`,"future":true}`)...)
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := artifact
			mutate(&candidate)
			if marked, err := validateApprovalArtifact(candidate); err == nil || !marked {
				t.Fatalf("invalid approval artifact: marked=%t err=%v", marked, err)
			}
		})
	}

	decision := artifact
	decision.Kind = "approval.decision"
	decision.RunID = "run_current"
	marker.ApprovalOccurrence.Slot = "decision"
	decision.Attributes, _ = json.Marshal(marker)
	decision.ArtifactID, _ = approvalArtifactID(marker)
	if marked, err := validateApprovalArtifact(decision); err != nil || !marked {
		t.Fatalf("cross-run decision: marked=%t err=%v", marked, err)
	}
}
