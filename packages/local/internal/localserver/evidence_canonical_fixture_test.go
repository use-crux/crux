package localserver

const (
	canonicalEvidenceRunID     = "run_evidence_canonical_e2e"
	canonicalEvidenceTraceID   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	canonicalEvidenceSpanID    = "1111111111111111"
	canonicalEvidenceSegmentID = "seg_evidence_canonical_e2e"
	canonicalEvidenceTimestamp = "2026-07-30T09:00:00Z"
)

func canonicalEvidenceLifecycleRecords() []map[string]any {
	return []map[string]any{
		canonicalRecord(1, "lifecycle_run_start", "run:start", map[string]any{
			"traceId":       canonicalEvidenceTraceID,
			"name":          "canonical evidence E2E",
			"rootPrimitive": "agent.run",
			"startedAt":     canonicalEvidenceTimestamp,
			"status":        "running",
		}),
		canonicalRecord(2, "lifecycle_span_start", "span:start", map[string]any{
			"traceId":   canonicalEvidenceTraceID,
			"spanId":    canonicalEvidenceSpanID,
			"family":    "agent",
			"primitive": "agent.run",
			"name":      "canonical evidence producer",
			"startedAt": canonicalEvidenceTimestamp,
			"status":    "running",
		}),
		canonicalRecord(3, "lifecycle_span_end", "span:end", map[string]any{
			"traceId": canonicalEvidenceTraceID,
			"spanId":  canonicalEvidenceSpanID,
			"endedAt": "2026-07-30T09:00:01Z",
			"status":  "ok",
		}),
		canonicalRecord(4, "lifecycle_run_end", "run:end", map[string]any{
			"traceId": canonicalEvidenceTraceID,
			"endedAt": "2026-07-30T09:00:01Z",
			"status":  "ok",
		}),
	}
}

func canonicalEvidenceRelationshipRecords() []map[string]any {
	intentArtifact := canonicalEvidenceArtifact(
		5,
		"0000000000001001",
		"artifact_0000000000001001",
		"input",
		map[string]any{"goal": "ship safely"},
	)
	intent := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 6, suffix: "0000000000001001",
		sourceID: "artifact_0000000000001001", role: "intent",
		kind: "input", sourceMode: "inline", captureState: "available",
	})
	authorityRequest := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 7, suffix: "0000000000002001",
		sourceID: "artifact_0000000000002001", role: "authority",
		kind: "approval.request", conclusion: "inconclusive",
		sourceMode: "reference", captureState: "reference",
	})
	authorityAllowed := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 8, suffix: "0000000000002002",
		sourceID: "artifact_0000000000002002", role: "authority",
		kind: "approval.decision", conclusion: "allowed",
		sourceMode: "reference", captureState: "reference",
		supersedes: []string{"evidence_0000000000002001"},
	})
	authorityDenied := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 9, suffix: "0000000000002003",
		sourceID: "artifact_0000000000002003", role: "authority",
		kind: "approval.decision", conclusion: "denied",
		sourceMode: "reference", captureState: "reference",
	})
	changeRedacted := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 10, suffix: "0000000000003001",
		sourceID: "artifact_0000000000003001", role: "change",
		kind: "memory.diff", conclusion: "applied",
		sourceMode: "inline", captureState: "redacted",
	})
	verificationHistory := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 11, suffix: "0000000000004001",
		sourceID: "artifact_0000000000004001", role: "verification",
		kind: "score.report", conclusion: "passed",
		sourceMode: "reference", captureState: "reference",
	})
	verificationArtifact := canonicalEvidenceArtifact(
		12,
		"0000000000004002",
		"artifact_0000000000004002",
		"score.report",
		map[string]any{"score": 0.2, "review": "safe"},
	)
	verificationFailed := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: 13, suffix: "0000000000004002",
		sourceID: "artifact_0000000000004002", role: "verification",
		kind: "score.report", conclusion: "failed",
		sourceMode: "inline", captureState: "available",
		supersedes: []string{"evidence_0000000000004001"},
	})
	idempotent := canonicalIdempotentEvidenceEdge(14, "first", "passed")
	retry := canonicalIdempotentEvidenceEdge(15, "retry", "passed")
	conflict := canonicalIdempotentEvidenceEdge(16, "conflict", "failed")

	return []map[string]any{
		intentArtifact,
		intent,
		authorityRequest,
		authorityAllowed,
		authorityDenied,
		changeRedacted,
		verificationHistory,
		verificationArtifact,
		verificationFailed,
		idempotent,
		retry,
		conflict,
	}
}

type canonicalEdgeInput struct {
	sequence     int
	suffix       string
	sourceID     string
	role         string
	kind         string
	conclusion   string
	sourceMode   string
	captureState string
	supersedes   []string
}

func canonicalEvidenceEdge(input canonicalEdgeInput) map[string]any {
	attributes := map[string]any{
		"evidenceId":   "evidence_" + input.suffix,
		"role":         input.role,
		"evidenceKind": input.kind,
		"recordedAt":   canonicalEvidenceTimestamp,
		"producer": map[string]any{
			"kind": "span",
			"id":   canonicalEvidenceSpanID,
		},
		"captureState": input.captureState,
		"sourceMode":   input.sourceMode,
	}
	if input.conclusion != "" {
		attributes["conclusion"] = input.conclusion
	}
	if len(input.supersedes) > 0 {
		attributes["supersedesEvidenceIds"] = input.supersedes
	}
	return canonicalRecord(
		input.sequence,
		"edge_"+input.suffix,
		"edge",
		map[string]any{
			"edgeId":   "edge_" + input.suffix,
			"edgeType": "evidence.for",
			"from": map[string]any{
				"kind": "artifact",
				"id":   input.sourceID,
			},
			"to": map[string]any{
				"kind": "span",
				"id":   canonicalEvidenceSpanID,
			},
			"createdAt":  canonicalEvidenceTimestamp,
			"attributes": attributes,
		},
	)
}

func canonicalIdempotentEvidenceEdge(
	sequence int,
	recordSuffix string,
	conclusion string,
) map[string]any {
	record := canonicalEvidenceEdge(canonicalEdgeInput{
		sequence: sequence, suffix: "4444444444444444",
		sourceID: "artifact_3333333333333333", role: "verification",
		kind: "score.report", conclusion: conclusion,
		sourceMode: "reference", captureState: "reference",
	})
	record["recordId"] = "rec_evidence_idempotent_" + recordSuffix
	record["edgeId"] = "edge_evidence_idempotent_" + recordSuffix
	attributes := record["attributes"].(map[string]any)
	attributes["idempotencyKeyHash"] =
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	attributes["contentDigestVersion"] = 1
	attributes["contentDigest"] =
		"sha256:227022c50c083e0f2707edf8150d233e10779fd3338e502c27d981b8ce4455b1"
	return record
}

func canonicalEvidenceArtifact(
	sequence int,
	evidenceSuffix string,
	artifactID string,
	kind string,
	preview any,
) map[string]any {
	return canonicalRecord(sequence, "artifact_"+evidenceSuffix, "artifact",
		map[string]any{
			"traceId":     canonicalEvidenceTraceID,
			"artifactId":  artifactID,
			"kind":        kind,
			"createdAt":   canonicalEvidenceTimestamp,
			"contentType": "application/json",
			"encoding":    "json",
			"preview":     preview,
			"attributes": map[string]any{
				"evidenceSource": map[string]any{
					"evidenceId":   "evidence_" + evidenceSuffix,
					"captureState": "available",
				},
			},
		})
}

func canonicalRecord(
	sequence int,
	recordSuffix string,
	recordType string,
	fields map[string]any,
) map[string]any {
	record := map[string]any{
		"schemaVersion": 5,
		"recordId":      "rec_evidence_canonical_" + recordSuffix,
		"type":          recordType,
		"operationId":   canonicalEvidenceRunID,
		"runId":         canonicalEvidenceRunID,
		"segmentId":     canonicalEvidenceSegmentID,
		"segmentSeq":    sequence,
	}
	for key, value := range fields {
		record[key] = value
	}
	return record
}
