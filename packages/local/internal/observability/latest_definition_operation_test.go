package observability

import (
	"context"
	"testing"
)

func TestLatestOperationForDefinitionSelectsGreatestFirstSeenAt(t *testing.T) {
	service := newTestService(t)
	ref := definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")
	mustIngest(t, service,
		runStartWithRefsJSON(
			"record-older",
			"operation-older",
			"segment-older",
			1,
			"2026-01-01T00:00:00.000Z",
			ref,
		),
		runStartWithRefsJSON(
			"record-newer",
			"operation-newer",
			"segment-newer",
			1,
			"2026-01-02T00:00:00.000Z",
			ref,
		),
	)

	snapshot, err := service.LatestOperationForDefinition(
		context.Background(),
		"prompt:greeting",
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.OperationID != "operation-newer" {
		t.Fatalf("operation ID = %q, want operation-newer", snapshot.OperationID)
	}
}

func TestLatestOperationForDefinitionBreaksTimestampTiesByOperationID(t *testing.T) {
	service := newTestService(t)
	ref := definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")
	mustIngest(t, service,
		runStartWithRefsJSON(
			"record-alpha",
			"operation-alpha",
			"segment-alpha",
			1,
			"2026-01-01T00:00:00.000Z",
			ref,
		),
		runStartWithRefsJSON(
			"record-zulu",
			"operation-zulu",
			"segment-zulu",
			1,
			"2026-01-01T00:00:00.000Z",
			ref,
		),
	)

	snapshot, err := service.LatestOperationForDefinition(
		context.Background(),
		"prompt:greeting",
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.OperationID != "operation-zulu" {
		t.Fatalf("operation ID = %q, want operation-zulu", snapshot.OperationID)
	}
}

func TestLatestOperationForDefinitionUsesOneSQLiteSnapshot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	service, err := OpenService(ctx, t.TempDir()+"/observability.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.Close(); err != nil {
			t.Fatal(err)
		}
	})

	ref := definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")
	mustIngest(t, service, runStartWithRefsJSON(
		"record-before",
		"operation-before",
		"segment-before",
		1,
		"2026-01-01T00:00:00.000Z",
		ref,
	))

	snapshot, err := service.latestOperationForDefinitionAtSnapshot(
		ctx,
		"prompt:greeting",
		func() {
			mustIngest(t, service, runStartWithRefsJSON(
				"record-after",
				"operation-after",
				"segment-after",
				1,
				"2026-01-02T00:00:00.000Z",
				ref,
			))
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.OperationID != "operation-before" {
		t.Fatalf("snapshot operation ID = %q, want operation-before", snapshot.OperationID)
	}

	next, err := service.LatestOperationForDefinition(ctx, "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if next.OperationID != "operation-after" {
		t.Fatalf("next operation ID = %q, want operation-after", next.OperationID)
	}
	if next.Revision <= snapshot.Revision {
		t.Fatalf(
			"next revision = %d, want greater than snapshot revision %d",
			next.Revision,
			snapshot.Revision,
		)
	}
}
