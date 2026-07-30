package localserver

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestEvidenceCanonicalRestartE2E(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "observability.sqlite")
	acceptedAt := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	process := startCanonicalEvidenceProcess(t, databasePath, acceptedAt)

	assertCanonicalEvidenceDispositions(
		t,
		postCanonicalEvidenceBatch(
			t,
			process.baseURL,
			canonicalEvidenceLifecycleRecords(),
		),
		0,
	)
	dispositions := postCanonicalEvidenceBatch(
		t,
		process.baseURL,
		canonicalEvidenceRelationshipRecords(),
	)
	assertCanonicalEvidenceDispositions(t, dispositions, 1)
	conflict := dispositions[len(dispositions)-1]
	if conflict.Code != "EVIDENCE_IDEMPOTENCY_CONFLICT" ||
		conflict.Retryable {
		t.Fatalf("durable conflict = %#v", conflict)
	}

	request := canonicalEvidenceInspectRequest(1)
	before := inspectCanonicalEvidenceHTTP(t, process.baseURL, request)
	assertCanonicalEvidenceFirstPage(t, before)
	cursor := before.Roles.Verification.Cursor

	agentResult, err := api.New(process.baseURL).InspectEvidence(
		t.Context(),
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	directResult := inspectCanonicalEvidenceDirect(
		t,
		process.baseURL,
		request,
	)
	if !reflect.DeepEqual(before, agentResult) ||
		!reflect.DeepEqual(before, directResult) {
		t.Fatalf(
			"canonical adapters drifted\nhttp=%#v\nagent=%#v\ndirect=%#v",
			before,
			agentResult,
			directResult,
		)
	}

	process.stop(t)
	process = startCanonicalEvidenceProcess(t, databasePath, acceptedAt)
	restarted := inspectCanonicalEvidenceHTTP(t, process.baseURL, request)
	if restarted.Roles.Verification.ActiveRecordCount !=
		before.Roles.Verification.ActiveRecordCount ||
		restarted.Roles.Verification.Cursor != cursor {
		t.Fatalf(
			"same-snapshot restart drifted\nbefore=%#v\nafter=%#v",
			before.Roles.Verification,
			restarted.Roles.Verification,
		)
	}
	pageRequest := request
	pageRequest.Cursor = cursor
	page := inspectCanonicalEvidenceHTTP(t, process.baseURL, pageRequest)
	if len(page.Roles.Verification.Records) != 1 {
		t.Fatalf("cursor page = %#v", page.Roles.Verification)
	}

	process.stop(t)
	process = startCanonicalEvidenceProcess(
		t,
		databasePath,
		acceptedAt.Add(25*time.Hour),
	)
	assertCanonicalCursorInvalid(t, process.baseURL, pageRequest)
	finalRequest := canonicalEvidenceAllRolesRequest()
	final := inspectCanonicalEvidenceHTTP(t, process.baseURL, finalRequest)
	assertCanonicalEvidenceAfterPayloadRetention(t, final)
	assertCanonicalEvidenceGolden(t, final)
}

func canonicalEvidenceAllRolesRequest() observability.EvidenceInspectRequest {
	return observability.EvidenceInspectRequest{
		Subject: observability.EvidenceInspectSubject{
			Kind: "execution",
			ID:   canonicalEvidenceSpanID,
		},
		Limit:          50,
		IncludeHistory: true,
		IncludeData:    true,
	}
}

func canonicalEvidenceInspectRequest(
	limit int,
) observability.EvidenceInspectRequest {
	return observability.EvidenceInspectRequest{
		Subject: observability.EvidenceInspectSubject{
			Kind: "execution",
			ID:   canonicalEvidenceSpanID,
		},
		Role:           "verification",
		Limit:          limit,
		IncludeHistory: true,
		IncludeData:    true,
	}
}

func assertCanonicalEvidenceFirstPage(
	t *testing.T,
	result observability.EvidenceInspectResult,
) {
	t.Helper()
	role := result.Roles.Verification
	if role.Status != "present" ||
		role.ActiveRecordCount != 2 ||
		!role.Conflicting ||
		role.Conclusion != "" ||
		!role.Truncated ||
		role.Cursor == "" ||
		len(role.Records) != 1 {
		t.Fatalf("verification first page = %#v", role)
	}
	record := role.Records[0]
	if record.AcceptedAfterTerminal == nil ||
		record.AcceptedAfterTerminal.JudgedAgainst.Kind != "span" ||
		record.AcceptedAfterTerminal.JudgedAgainst.ID !=
			canonicalEvidenceSpanID {
		t.Fatalf("late evidence = %#v", record.AcceptedAfterTerminal)
	}
}

func assertCanonicalEvidenceAfterPayloadRetention(
	t *testing.T,
	result observability.EvidenceInspectResult,
) {
	t.Helper()
	verification := result.Roles.Verification
	if result.Roles.Intent.ActiveRecordCount != 1 ||
		len(result.Roles.Intent.Records) != 1 ||
		result.Roles.Authority.ActiveRecordCount != 2 ||
		len(result.Roles.Authority.Records) != 2 ||
		len(result.Roles.Authority.History) != 1 ||
		!result.Roles.Authority.Conflicting ||
		result.Roles.Change.ActiveRecordCount != 1 ||
		len(result.Roles.Change.Records) != 1 ||
		result.Roles.Change.Records[0].PayloadUnavailableReason != "policy" {
		t.Fatalf("retained roles = %#v", result.Roles)
	}
	if verification.ActiveRecordCount != 2 ||
		!verification.Conflicting ||
		len(verification.Records) != 2 ||
		len(verification.History) != 1 {
		t.Fatalf("retained verification = %#v", verification)
	}
	var expired bool
	for _, record := range verification.Records {
		if record.Ref.ID != "evidence_0000000000004002" {
			continue
		}
		expired = record.PayloadState == "redacted" &&
			record.PayloadUnavailableReason == "retention" &&
			len(record.Data) == 0
	}
	if !expired {
		t.Fatalf("payload retention was not projected: %#v", verification)
	}
}
