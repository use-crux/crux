package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidenceInspectorStatusMatchesCoreConformanceFixture(t *testing.T) {
	var fixture struct {
		Version int `json:"version"`
		Cases   []struct {
			Name                string   `json:"name"`
			ActivePayloadStates []string `json:"activePayloadStates"`
			ActiveRecordCount   int      `json:"activeRecordCount"`
			Coverage            []string `json:"coverage"`
			Status              string   `json:"status"`
			CoverageIncluded    bool     `json:"coverageIncluded"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(
		readCoreEvidenceFixture(t, "destination-status-v1.json"),
		&fixture,
	); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != 1 {
		t.Fatalf("fixture version = %d", fixture.Version)
	}

	for _, testCase := range fixture.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			summary := evidenceRoleSummary{
				activeCount: len(testCase.ActivePayloadStates),
			}
			for _, state := range testCase.ActivePayloadStates {
				switch state {
				case "available", "reference":
					summary.usableCount++
				case "redacted":
					summary.redactedCount++
				case "not-captured":
					summary.uncapturedCount++
				default:
					t.Fatalf("unknown fixture payload state %q", state)
				}
			}

			status, coverageIncluded := evidenceRoleStatus(
				summary,
				testCase.Coverage,
			)
			if status != testCase.Status ||
				summary.activeCount != testCase.ActiveRecordCount ||
				coverageIncluded != testCase.CoverageIncluded {
				t.Fatalf(
					"status = %q/%t, want %q/%t",
					status,
					coverageIncluded,
					testCase.Status,
					testCase.CoverageIncluded,
				)
			}
		})
	}
}

func TestEvidenceInspectorComputesUnavailableActiveStatusesBeforeHydration(
	t *testing.T,
) {
	for index, status := range []string{"redacted", "not-captured"} {
		t.Run(status, func(t *testing.T) {
			service := newTestService(t)
			fixture := evidenceRelationshipFixture(
				t,
				[]string{
					"0000000000000001",
					"0000000000000002",
				}[index],
				"verification",
				"passed",
				index+1,
			)
			fixture.sourceMode = "inline"
			fixture.captureState = status
			fixture.nonIdempotent = true
			fixture.idempotencyKeyHash = ""
			fixture.digest = ""

			disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			)
			if disposition.Outcome != "accepted" {
				t.Fatalf("disposition = %#v", disposition)
			}
			result, err := service.InspectEvidence(
				t.Context(),
				EvidenceInspectRequest{
					Subject: EvidenceInspectSubject{
						Kind: "execution",
						ID:   fixture.subject.ID,
					},
					Role:  "intent",
					Limit: 50,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			role := result.Roles.Verification
			if role.Status != status ||
				role.Coverage != "" ||
				role.Conclusion != "passed" ||
				len(role.Records) != 0 {
				t.Fatalf("role = %#v", role)
			}
		})
	}
}

func TestEvidenceInspectorRejectsUnsafeActiveRecordCount(t *testing.T) {
	_, err := projectEvidenceInspectRole(
		EvidenceInspectRequest{Limit: 1},
		"verification",
		nil,
		evidenceRoleSummary{activeCount: maxEvidenceSafeInteger + 1},
		nil,
		false,
		evidenceCursorBinding{},
	)
	if err == nil {
		t.Fatal("expected unsafe count rejection")
	}
}
