package eventwire

import (
	"encoding/base64"
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

func TestProjectIndexArtifactStreamCollectorAssemblesChunkedPayload(t *testing.T) {
	collector := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{
		Root:     "/repo",
		Artifact: ProjectIndexArtifactProjectModel,
	})
	payload := `{"root":"/repo","files":[{"file":"/repo/src/a.ts"}]}`
	chunks := []string{payload[:20], payload[20:]}
	events := []map[string]any{
		{
			"protocolVersion": 2,
			"type":            "artifact:chunk",
			"transactionId":   "artifact-project-model",
			"artifact":        "projectModel",
			"root":            "/repo",
			"sequence":        0,
			"encoding":        "base64",
			"payloadChunk":    base64.StdEncoding.EncodeToString([]byte(chunks[0])),
		},
		{
			"protocolVersion": 2,
			"type":            "artifact:chunk",
			"transactionId":   "artifact-project-model",
			"artifact":        "projectModel",
			"root":            "/repo",
			"sequence":        1,
			"encoding":        "base64",
			"payloadChunk":    base64.StdEncoding.EncodeToString([]byte(chunks[1])),
		},
		{
			"protocolVersion": 2,
			"type":            "artifact:done",
			"transactionId":   "artifact-project-model",
			"artifact":        "projectModel",
			"root":            "/repo",
		},
	}

	for _, event := range events {
		if err := collector.Handle(mustMarshalWorkerEvent(t, event)); err != nil {
			t.Fatalf("Handle(%s) error = %v", event["type"], err)
		}
	}

	payloadBytes, err := collector.Payload()
	if err != nil {
		t.Fatalf("Payload error = %v", err)
	}
	if string(payloadBytes) != payload {
		t.Fatalf("payload = %s, want %s", payloadBytes, payload)
	}
}
