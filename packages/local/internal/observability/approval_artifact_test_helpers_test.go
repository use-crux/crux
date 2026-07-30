package observability

import (
	"encoding/json"
	"testing"
)

func approvalRunStartRecord(
	t *testing.T,
	runID string,
	segmentID string,
) Record {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"schemaVersion": 5,
		"recordId":      "rec_start_" + runID,
		"type":          "run:start",
		"operationId":   runID,
		"runId":         runID,
		"segmentId":     segmentID,
		"segmentSeq":    1,
		"name":          "approval",
		"rootPrimitive": "tool.approval",
		"startedAt":     "2026-07-30T00:00:00Z",
		"status":        "running",
	})
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(payload))
}

func approvalDecisionArtifactRecord(
	t *testing.T,
	recordID string,
	runID string,
	segmentID string,
	segmentSeq int,
	preview any,
) Record {
	t.Helper()
	marker := approvalArtifactAttributes{
		ApprovalOccurrence: approvalArtifactOccurrence{
			Domain:        "crux.tool.approval",
			IdentityEpoch: 1,
			Namespace: approvalArtifactNamespace{
				OperationID: "run_original_operation",
				RunID:       "run_original_request",
			},
			ApprovalID: "approval_call",
			Slot:       "decision",
		},
	}
	return approvalArtifactRecord(
		t,
		recordID,
		runID,
		runID,
		segmentID,
		segmentSeq,
		"approval.decision",
		marker,
		preview,
	)
}

func approvalArtifactRecord(
	t *testing.T,
	recordID string,
	operationID string,
	runID string,
	segmentID string,
	segmentSeq int,
	kind string,
	marker approvalArtifactAttributes,
	preview any,
) Record {
	t.Helper()
	artifactID, err := approvalArtifactID(marker)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{
		"schemaVersion": 5,
		"recordId":      recordID,
		"type":          "artifact",
		"operationId":   operationID,
		"runId":         runID,
		"segmentId":     segmentID,
		"segmentSeq":    segmentSeq,
		"artifactId":    artifactID,
		"kind":          kind,
		"createdAt":     "2026-07-30T00:00:00Z",
		"contentType":   "application/json",
		"encoding":      "json",
		"preview":       preview,
		"attributes":    marker,
	})
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(payload))
}
