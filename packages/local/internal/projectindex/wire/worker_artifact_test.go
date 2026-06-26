package wire

import (
	"strings"
	"testing"
)

func TestProjectIndexArtifactStreamCollectorBuildsPayload(t *testing.T) {
	collector := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{
		Root:     "/repo",
		Artifact: ProjectIndexArtifactProjectModel,
		MaxBytes: 1024,
	})

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "artifact:done",
		"transactionId":   "artifact-project-model",
		"artifact":        "projectModel",
		"root":            "/repo",
		"payload": map[string]any{
			"root": map[string]any{"value": "/repo"},
		},
	}))
	if err != nil {
		t.Fatalf("Handle artifact:done error = %v", err)
	}

	payload, err := collector.Payload()
	if err != nil {
		t.Fatalf("Payload error = %v", err)
	}
	if !strings.Contains(string(payload), `"/repo"`) {
		t.Fatalf("payload = %s, want project root", payload)
	}
}

func TestProjectIndexArtifactStreamCollectorRejectsWrongArtifact(t *testing.T) {
	collector := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{
		Root:     "/repo",
		Artifact: ProjectIndexArtifactProjectConfig,
	})

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "artifact:done",
		"transactionId":   "artifact-project-model",
		"artifact":        "projectModel",
		"root":            "/repo",
		"payload":         map[string]any{"root": "/repo"},
	}))

	if err == nil || !strings.Contains(err.Error(), "artifact") {
		t.Fatalf("Handle wrong artifact error = %v, want artifact error", err)
	}
}
