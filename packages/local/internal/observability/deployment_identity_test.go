package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func TestRecordSchemaVersionsAndDeploymentIdentity(t *testing.T) {
	v2 := mustRecord(t, `{"schemaVersion":2,"recordId":"rec_v2","type":"run:start","runId":"run_111111111111111111111111","segmentId":"seg_111111111111111111111111","segmentSeq":1,"name":"v2","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running"}`)
	if err := ValidateRecord(v2); err == nil {
		t.Fatal("expected schema v2 record to be rejected after the operation-family cutover")
	}

	v2WithDeployment := mustRecord(t, `{"schemaVersion":2,"recordId":"rec_v2_deployment","type":"run:start","runId":"run_222222222222222222222222","segmentId":"seg_222222222222222222222222","segmentSeq":1,"name":"v2","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout"}}`)
	if err := ValidateRecord(v2WithDeployment); err == nil {
		t.Fatal("expected v2 deployment identity to be rejected")
	}

	v3 := mustRecord(t, `{"schemaVersion":3,"recordId":"rec_v3","type":"run:start","runId":"run_333333333333333333333333","segmentId":"seg_333333333333333333333333","segmentSeq":1,"name":"v3","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout","manifestId":"pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deploymentId":"production-42"}}`)
	if err := ValidateRecord(v3); err == nil {
		t.Fatal("expected schema v3 record to be rejected after the operation-family cutover")
	}

	v4 := mustRecord(t, `{"schemaVersion":4,"recordId":"rec_v4","type":"run:start","runId":"run_333333333333333333333333","operationId":"run_333333333333333333333333","segmentId":"seg_333333333333333333333333","segmentSeq":1,"name":"v4","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout","manifestId":"pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deploymentId":"production-42"}}`)
	if err := ValidateRecord(v4); err != nil {
		t.Fatalf("valid v4 deployment identity failed validation: %v", err)
	}

	malformed := mustRecord(t, `{"schemaVersion":4,"recordId":"rec_v4_bad","type":"run:start","runId":"run_444444444444444444444444","operationId":"run_444444444444444444444444","segmentId":"seg_444444444444444444444444","segmentSeq":1,"name":"v4","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":" checkout "}}`)
	if err := ValidateRecord(malformed); err == nil {
		t.Fatal("expected malformed v3 deployment identity to be rejected")
	}
}

func TestRunDetailPersistsDeploymentIdentity(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	deployment := `"deployment":{"projectId":"checkout","manifestId":"pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deploymentId":"production-42"}`
	batch := mustBatch(t,
		`{"schemaVersion":3,"recordId":"rec_deployment_start","type":"run:start","runId":"run_deployment_identity","segmentId":"seg_deployment_identity","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"deployment","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running",`+deployment+`}`,
		`{"schemaVersion":3,"recordId":"rec_deployment_end","type":"run:end","runId":"run_deployment_identity","segmentId":"seg_deployment_identity","segmentSeq":2,"traceId":"11111111111111111111111111111111","endedAt":"2026-07-14T12:00:01.000Z","status":"ok",`+deployment+`}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_deployment_identity")
	if err != nil {
		t.Fatal(err)
	}
	want := &DeploymentIdentity{
		ProjectID:    "checkout",
		ManifestID:   "pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		DeploymentID: "production-42",
	}
	if detail.Run.Deployment == nil || *detail.Run.Deployment != *want {
		t.Fatalf("run deployment = %#v, want %#v", detail.Run.Deployment, want)
	}
}

func TestIngestRejectsDeploymentIdentityChangesWithinRun(t *testing.T) {
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":3,"recordId":"rec_identity_a","type":"run:start","runId":"run_identity_conflict","segmentId":"seg_identity_conflict","segmentSeq":1,"name":"identity","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout","deploymentId":"production-42"}}`,
		`{"schemaVersion":3,"recordId":"rec_identity_b","type":"run:end","runId":"run_identity_conflict","segmentId":"seg_identity_conflict","segmentSeq":2,"endedAt":"2026-07-14T12:00:01.000Z","status":"ok","deployment":{"projectId":"checkout","deploymentId":"production-43"}}`,
	)
	if err := service.Ingest(context.Background(), batch); err == nil {
		t.Fatal("expected a run-level deployment identity conflict")
	}
}

func TestIngestRejectsRemovingDeploymentIdentityWithinRun(t *testing.T) {
	for _, schemaVersion := range []int{2, 3} {
		t.Run(fmt.Sprintf("schema-v%d", schemaVersion), func(t *testing.T) {
			service := newTestService(t)
			ctx := context.Background()
			if err := service.Ingest(ctx, mustBatch(t,
				`{"schemaVersion":3,"recordId":"rec_identity_present","type":"run:start","runId":"run_identity_removed","segmentId":"seg_identity_removed","segmentSeq":1,"name":"identity","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout","deploymentId":"production-42"}}`,
			)); err != nil {
				t.Fatal(err)
			}
			raw := fmt.Sprintf(`{"schemaVersion":%d,"recordId":"rec_identity_absent_%d","type":"run:end","runId":"run_identity_removed","segmentId":"seg_identity_removed","segmentSeq":2,"endedAt":"2026-07-14T12:00:01.000Z","status":"ok"}`, schemaVersion, schemaVersion)
			if err := service.Ingest(ctx, mustBatch(t, raw)); err == nil {
				t.Fatal("expected deployment identity removal to be rejected")
			}
		})
	}
}

func TestDeploymentIdentityImmutabilitySurvivesServiceRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":3,"recordId":"rec_identity_restart_start","type":"run:start","runId":"run_identity_restart","segmentId":"seg_identity_restart","segmentSeq":1,"name":"identity","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running","deployment":{"projectId":"checkout","deploymentId":"production-42"}}`,
	)); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if err := reopened.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":3,"recordId":"rec_identity_restart_end","type":"run:end","runId":"run_identity_restart","segmentId":"seg_identity_restart","segmentSeq":2,"endedAt":"2026-07-14T12:00:01.000Z","status":"ok"}`,
	)); err == nil {
		t.Fatal("expected persisted deployment identity removal to be rejected")
	}
}

func TestIngestDoesNotRewriteDeploymentUnspecifiedV2Run(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_unspecified_start","type":"run:start","runId":"run_unspecified_identity","segmentId":"seg_unspecified_identity","segmentSeq":1,"name":"unspecified","rootPrimitive":"run","startedAt":"2026-07-14T12:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":3,"recordId":"rec_unspecified_end","type":"run:end","runId":"run_unspecified_identity","segmentId":"seg_unspecified_identity","segmentSeq":2,"endedAt":"2026-07-14T12:00:01.000Z","status":"ok","deployment":{"projectId":"checkout"}}`,
	)); err == nil {
		t.Fatal("expected persisted v2 deployment-unspecified identity to remain immutable")
	}
}

func mustRecord(t *testing.T, raw string) Record {
	t.Helper()
	var record Record
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		t.Fatal(err)
	}
	return record
}
