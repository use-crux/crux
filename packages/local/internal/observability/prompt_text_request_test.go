package observability

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailReconstructsPromptTextUserPrompt(t *testing.T) {
	t.Parallel()

	started := time.Date(2026, 7, 29, 20, 0, 0, 0, time.UTC)
	preview := json.RawMessage(`{
		"input":{"name":"Ada"},
		"userPrompt":{
			"kind":"prompt-text",
			"text":"Hello Ada\n値",
			"segments":[
				{"text":"Hello ","dynamic":false},
				{"text":"Ada","dynamic":true,"source":"name"},
				{"text":"\n","dynamic":false},
				{"text":"値","dynamic":true}
			],
			"tokens":4,
			"staticTokens":2,
			"dynamicTokens":2
		}
	}`)
	graph := Graph{
		Run: RunSummary{
			RunID: "run-prompt-text", TraceID: "trace-prompt-text",
			Name: "writer", RootPrimitive: "generation.call", Status: "ok",
			StartedAt: started.Format(time.RFC3339Nano),
			EndedAt:   started.Add(time.Second).Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{{
			RunID: "run-prompt-text", TraceID: "trace-prompt-text",
			SpanID: "span-generation", Family: "generation",
			Primitive: "generation.call", Name: "writer", Status: "ok",
			StartedAt: started.Format(time.RFC3339Nano),
			EndedAt:   started.Add(time.Second).Format(time.RFC3339Nano),
		}},
		Artifacts: []ArtifactSummary{{
			ArtifactID: "artifact-messages", RunID: "run-prompt-text",
			TraceID: "trace-prompt-text", SpanID: "span-generation",
			Kind: "messages", ContentType: "application/json", Encoding: "json",
			Preview: preview, CreatedAt: started.Format(time.RFC3339Nano),
		}},
		Edges: []EdgeSummary{{
			EdgeID: "edge-messages", RunID: "run-prompt-text",
			TraceID: "trace-prompt-text", EdgeType: "consumed",
			From:      NodeRef{Kind: "artifact", ID: "artifact-messages"},
			To:        NodeRef{Kind: "span", ID: "span-generation"},
			CreatedAt: started.Format(time.RFC3339Nano),
		}},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{
		Now: started.Add(2 * time.Second),
	})
	if detail.Root.Request == nil || detail.Root.Request.UserPrompt == nil {
		t.Fatalf("request = %#v, want PromptText user prompt", detail.Root.Request)
	}
	got := detail.Root.Request.UserPrompt
	if got.Text != "Hello Ada\n値" ||
		got.Tokens != 4 ||
		got.StaticTokens != 2 ||
		got.DynamicTokens != 2 {
		t.Fatalf("user prompt = %#v", got)
	}
	if len(got.Segments) != 4 || got.Segments[1].Source != "name" {
		t.Fatalf("segments = %#v", got.Segments)
	}
}

func TestProjectRunDetailFallsBackToPlainTextForInvalidPromptText(t *testing.T) {
	t.Parallel()

	artifact := ArtifactSummary{
		ArtifactID: "artifact-invalid", Kind: "messages",
		Preview: json.RawMessage(`{
			"input":{},
			"userPrompt":{
				"kind":"prompt-text",
				"text":"Hello Ada",
				"segments":[{"text":"different","dynamic":false}],
				"tokens":2,
				"staticTokens":2,
				"dynamicTokens":0
			}
		}`),
	}

	if got := requestUserPromptFromMessages(artifact); got != nil {
		t.Fatalf("user prompt = %#v, want invalid evidence omitted", got)
	}
	messages := requestMessagesFromArtifact(artifact)
	if string(messages.Prompt) != `"Hello Ada"` {
		t.Fatalf("plain prompt = %s, want exact fallback", messages.Prompt)
	}
}

func TestPromptTextUserPromptPersistsAcrossRestart(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	ctx := context.Background()
	path := t.TempDir() + "/observability.sqlite"

	var batch Batch
	if err := json.Unmarshal(readCoreObservabilityFixture(t, "prompt-text-run.json"), &batch); err != nil {
		t.Fatal(err)
	}
	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopened.Close(); err != nil {
			t.Fatal(err)
		}
	})

	detail, err := reopened.RunDetail(ctx, "run_prompt_text")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Root.Request == nil || detail.Root.Request.UserPrompt == nil {
		t.Fatalf("persisted request = %#v, want PromptText user prompt", detail.Root.Request)
	}
	got := detail.Root.Request.UserPrompt
	if got.Text != "Hello Ada\nNested 値\n{\n  \"ready\": true\n}" {
		t.Fatalf("persisted text = %q", got.Text)
	}
	if got.Tokens != 10 || got.StaticTokens != 5 || got.DynamicTokens != 7 {
		t.Fatalf("persisted tokens = %#v", got)
	}
	if len(got.Segments) != 6 || got.Segments[3].Text != "値" {
		t.Fatalf("persisted segments = %#v", got.Segments)
	}
}
