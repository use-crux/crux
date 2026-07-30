package observability

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestEvidenceSubjectSummariesArePositionalAndComplete(t *testing.T) {
	service := newTestService(t)
	runID := "run_related_zero"
	if disposition := evidenceDisposition(
		t,
		service,
		approvalRunStartRecord(t, runID, "seg_related_zero"),
	); disposition.Outcome != "accepted" {
		t.Fatalf("run disposition = %#v", disposition)
	}
	for index, role := range []string{"verification", "authority"} {
		fixture := evidenceRelationshipFixture(
			t,
			fmt.Sprintf("%016x", index+1),
			role,
			map[string]string{
				"verification": "passed",
				"authority":    "allowed",
			}[role],
			index+1,
		)
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("evidence disposition = %#v", disposition)
		}
	}
	evidenceSubject := EvidenceInspectSubject{
		Kind: "execution",
		ID:   "2222222222222222",
	}
	request := EvidenceSubjectSummaryRequest{
		Subjects: []EvidenceInspectSubject{
			evidenceSubject,
			{Kind: "execution", ID: runID},
			{Kind: "execution", ID: "run_unknown"},
			evidenceSubject,
		},
	}
	response, err := service.SummarizeEvidenceSubjects(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != len(request.Subjects) {
		t.Fatalf("results = %d, want %d", len(response.Results), len(request.Subjects))
	}
	if response.Results[0].Status != "available" ||
		response.Results[0].TotalActiveRecordCount == nil ||
		*response.Results[0].TotalActiveRecordCount != 2 ||
		response.Results[1].Status != "available" ||
		response.Results[1].TotalActiveRecordCount == nil ||
		*response.Results[1].TotalActiveRecordCount != 0 ||
		response.Results[2].Status != "unavailable" ||
		response.Results[2].TotalActiveRecordCount != nil ||
		!reflect.DeepEqual(response.Results[3], response.Results[0]) {
		t.Fatalf("summary results = %#v", response.Results)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(
		string(encoded),
		`"status":"available","totalActiveRecordCount":0`,
	) {
		t.Fatalf("authorized zero count was omitted: %s", encoded)
	}
}

func TestEvidenceSubjectSummariesRejectMoreThanOneHundredSubjects(t *testing.T) {
	service := newTestService(t)
	_, err := service.SummarizeEvidenceSubjects(
		t.Context(),
		EvidenceSubjectSummaryRequest{
			Subjects: make([]EvidenceInspectSubject, 101),
		},
	)
	if err == nil {
		t.Fatal("expected bounded input rejection")
	}
}

func TestEvidenceNavigationResolvesExactPersistedOwnersAndRefs(t *testing.T) {
	service := newTestService(t)
	for _, raw := range []string{
		`{
			"schemaVersion":5,
			"recordId":"rec_nav_run",
			"type":"run:start",
			"operationId":"run_nav",
			"runId":"run_nav",
			"traceId":"11111111111111111111111111111111",
			"segmentId":"seg_nav",
			"segmentSeq":1,
			"name":"navigation",
			"rootPrimitive":"agent.run",
			"startedAt":"2026-07-30T00:00:00Z",
			"status":"running",
			"definitionRefs":[
				{"id":"agent:nav","kind":"agent","role":"invoked-agent"}
			]
		}`,
		`{
			"schemaVersion":5,
			"recordId":"rec_nav_span",
			"type":"span",
			"operationId":"run_nav",
			"runId":"run_nav",
			"traceId":"11111111111111111111111111111111",
			"segmentId":"seg_nav",
			"segmentSeq":2,
			"spanId":"span_nav",
			"family":"tool",
			"primitive":"tool.call",
			"name":"navigate",
			"startedAt":"2026-07-30T00:00:01Z",
			"status":"ok",
			"definitionRefs":[
				{"id":"tool:nav","kind":"tool","role":"invoked-tool"}
			]
		}`,
		`{
			"schemaVersion":5,
			"recordId":"rec_nav_artifact",
			"type":"artifact",
			"operationId":"run_nav",
			"runId":"run_nav",
			"traceId":"11111111111111111111111111111111",
			"segmentId":"seg_nav",
			"segmentSeq":3,
			"spanId":"span_nav",
			"artifactId":"artifact_nav",
			"kind":"custom.navigation",
			"createdAt":"2026-07-30T00:00:02Z",
			"contentType":"application/json",
			"encoding":"json",
			"preview":{"ok":true}
		}`,
	} {
		if disposition := evidenceDisposition(
			t,
			service,
			mustRecord(t, raw),
		); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	refs := []NodeRef{
		{Kind: "run", ID: "run_nav"},
		{Kind: "span", ID: "span_nav"},
		{Kind: "artifact", ID: "artifact_nav"},
		{Kind: "span", ID: "span_unknown"},
		{Kind: "run", ID: "run_nav"},
	}
	response, err := service.ResolveEvidenceNavigation(
		t.Context(),
		EvidenceNavigationRequest{Refs: refs},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != len(refs) {
		t.Fatalf("results = %d, want %d", len(response.Results), len(refs))
	}
	run := response.Results[0]
	span := response.Results[1]
	artifact := response.Results[2]
	if run.Target == nil ||
		run.Target.RunID != "run_nav" ||
		run.Target.RetainedDefinitionRefs == nil ||
		len(*run.Target.RetainedDefinitionRefs) != 1 ||
		(*run.Target.RetainedDefinitionRefs)[0].ID != "agent:nav" {
		t.Fatalf("run target = %#v", run)
	}
	if span.Target == nil ||
		span.Target.SpanID != "span_nav" ||
		span.Target.RetainedDefinitionRefs == nil ||
		len(*span.Target.RetainedDefinitionRefs) != 1 ||
		(*span.Target.RetainedDefinitionRefs)[0].ID != "tool:nav" {
		t.Fatalf("span target = %#v", span)
	}
	if artifact.Target == nil ||
		artifact.Target.Owner == nil ||
		artifact.Target.Owner.Kind != "span" ||
		artifact.Target.Owner.SpanID != "span_nav" ||
		len(artifact.Target.Owner.RetainedDefinitionRefs) != 1 ||
		artifact.Target.Owner.RetainedDefinitionRefs[0].ID != "tool:nav" {
		t.Fatalf("artifact target = %#v", artifact)
	}
	if response.Results[3].Status != "unavailable" ||
		response.Results[3].Reason != "unresolved" ||
		!reflect.DeepEqual(response.Results[4], response.Results[0]) {
		t.Fatalf("positional navigation = %#v", response.Results)
	}
}

func TestEvidenceNavigationRejectsMoreThanOneHundredRefs(t *testing.T) {
	service := newTestService(t)
	_, err := service.ResolveEvidenceNavigation(
		t.Context(),
		EvidenceNavigationRequest{Refs: make([]NodeRef, 101)},
	)
	if err == nil {
		t.Fatal("expected bounded input rejection")
	}
}

func TestEvidenceNavigationDistinguishesRetainedOutAndDeleted(t *testing.T) {
	service := newTestService(t)
	fixture := evidenceRelationshipFixture(
		t,
		"9999999999999999",
		"verification",
		"passed",
		1,
	)
	fixture.source = NodeRef{
		Kind: "artifact",
		ID:   "artifact_retained_source",
	}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence disposition = %#v", disposition)
	}
	deletedRunID := "run_deleted_navigation"
	if disposition := evidenceDisposition(
		t,
		service,
		approvalRunStartRecord(
			t,
			deletedRunID,
			"seg_deleted_navigation",
		),
	); disposition.Outcome != "accepted" {
		t.Fatalf("run disposition = %#v", disposition)
	}
	if _, err := service.DeleteRuns(t.Context(), []string{deletedRunID}); err != nil {
		t.Fatal(err)
	}

	response, err := service.ResolveEvidenceNavigation(
		t.Context(),
		EvidenceNavigationRequest{
			Refs: []NodeRef{
				{Kind: "artifact", ID: "artifact_retained_source"},
				{Kind: "run", ID: deletedRunID},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Results[0].Reason != "retained-out" ||
		response.Results[1].Reason != "deleted" {
		t.Fatalf("availability reasons = %#v", response.Results)
	}
}
