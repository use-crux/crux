package observability

import (
	"path/filepath"
	"testing"
)

func TestEvidenceAcceptedAfterTerminalUsesPersistedAcceptanceOrder(
	t *testing.T,
) {
	for _, terminalFirst := range []bool{true, false} {
		name := "evidence before terminal"
		if terminalFirst {
			name = "terminal before evidence"
		}
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			fixture := evidenceRelationshipFixture(
				t,
				"eeeeeeeeeeeeeeee",
				"verification",
				"passed",
				2,
			)
			fixture.observedAt = "2000-01-01T00:00:00Z"
			fixture.digest = evidenceFixtureDigest(t, fixture)
			edge := evidenceEdgeTestRecord(t, fixture)
			terminal := evidenceSpanTerminalRecord(
				t,
				fixture.subject.ID,
				1,
				"ok",
			)
			records := []Record{edge, terminal}
			if terminalFirst {
				records[0], records[1] = records[1], records[0]
			}
			dispositions := service.IngestWithDispositions(
				t.Context(),
				Batch{SchemaVersion: SchemaVersion, Records: records},
			)
			for _, disposition := range dispositions {
				if disposition.Outcome != "accepted" {
					t.Fatalf("dispositions = %#v", dispositions)
				}
			}

			result, err := service.InspectEvidence(
				t.Context(),
				EvidenceInspectRequest{
					Subject: EvidenceInspectSubject{
						Kind: "execution",
						ID:   fixture.subject.ID,
					},
					Role:  "verification",
					Limit: 50,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			record := result.Roles.Verification.Records[0]
			if terminalFirst {
				if record.AcceptedAfterTerminal == nil ||
					record.AcceptedAfterTerminal.JudgedAgainst.Kind != "span" ||
					record.AcceptedAfterTerminal.JudgedAgainst.ID !=
						fixture.subject.ID {
					t.Fatalf("lateness = %#v", record.AcceptedAfterTerminal)
				}
			} else if record.AcceptedAfterTerminal != nil {
				t.Fatalf("late backfill = %#v", record.AcceptedAfterTerminal)
			}
		})
	}
}

func TestEvidenceAcceptedAfterTerminalStatusMatrix(t *testing.T) {
	testCases := []struct {
		name      string
		subject   NodeRef
		terminal  func(*testing.T) Record
		qualifies bool
	}{
		{
			name:    "run ok",
			subject: NodeRef{Kind: "run", ID: "run_late_subject"},
			terminal: func(t *testing.T) Record {
				return evidenceRunTerminalRecord(t, "ok")
			},
			qualifies: true,
		},
		{
			name:    "run error",
			subject: NodeRef{Kind: "run", ID: "run_late_subject"},
			terminal: func(t *testing.T) Record {
				return evidenceRunTerminalRecord(t, "error")
			},
			qualifies: true,
		},
		{
			name:    "run blocked",
			subject: NodeRef{Kind: "run", ID: "run_late_subject"},
			terminal: func(t *testing.T) Record {
				return evidenceRunTerminalRecord(t, "blocked")
			},
			qualifies: true,
		},
		{
			name:    "run cancelled",
			subject: NodeRef{Kind: "run", ID: "run_late_subject"},
			terminal: func(t *testing.T) Record {
				return evidenceRunTerminalRecord(t, "cancelled")
			},
			qualifies: true,
		},
		{
			name:    "run suspended",
			subject: NodeRef{Kind: "run", ID: "run_late_subject"},
			terminal: func(t *testing.T) Record {
				return evidenceRunSuspensionRecord(t)
			},
		},
	}
	for _, status := range []string{
		"ok",
		"error",
		"blocked",
		"cancelled",
		"skipped",
		"suspended",
	} {
		status := status
		testCases = append(testCases, struct {
			name      string
			subject   NodeRef
			terminal  func(*testing.T) Record
			qualifies bool
		}{
			name:    "span " + status,
			subject: NodeRef{Kind: "span", ID: "2222222222222222"},
			terminal: func(t *testing.T) Record {
				return evidenceSpanTerminalRecord(
					t,
					"2222222222222222",
					1,
					status,
				)
			},
			qualifies: true,
		})
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			service := newTestService(t)
			if disposition := evidenceDisposition(
				t,
				service,
				testCase.terminal(t),
			); disposition.Outcome != "accepted" {
				t.Fatalf("terminal = %#v", disposition)
			}
			fixture := evidenceRelationshipFixture(
				t,
				"ffffffffffffffff",
				"verification",
				"passed",
				2,
			)
			fixture.subject = testCase.subject
			fixture.digest = evidenceFixtureDigest(t, fixture)
			if disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			); disposition.Outcome != "accepted" {
				t.Fatalf("evidence = %#v", disposition)
			}
			result, err := service.InspectEvidence(
				t.Context(),
				EvidenceInspectRequest{
					Subject: EvidenceInspectSubject{
						Kind: "execution",
						ID:   testCase.subject.ID,
					},
					Role:  "verification",
					Limit: 50,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			late := result.Roles.Verification.Records[0].
				AcceptedAfterTerminal
			if (late != nil) != testCase.qualifies {
				t.Fatalf("accepted after terminal = %#v", late)
			}
		})
	}
}

func TestEvidenceAcceptedAfterTerminalSurvivesRestart(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	fixture := evidenceRelationshipFixture(
		t,
		"eeeeeeeeeeeeeee1",
		"verification",
		"passed",
		2,
	)
	for _, record := range []Record{
		evidenceSpanTerminalRecord(t, fixture.subject.ID, 1, "ok"),
		evidenceEdgeTestRecord(t, fixture),
	} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("disposition = %#v", disposition)
		}
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	result, err := reopened.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.subject.ID,
			},
			Role:  "verification",
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Records[0].
		AcceptedAfterTerminal == nil {
		t.Fatal("restart lost accepted-after-terminal")
	}
}
