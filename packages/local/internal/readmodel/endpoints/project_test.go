package endpoints

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type fakeDevtools struct {
	index     api.IndexData
	watch     api.ProjectIndexWatchStatus
	values    map[string]any
	lastPath  string
	lastQuery url.Values
}

func (f fakeDevtools) ProjectIndex(context.Context) (api.IndexData, error) {
	return f.index, nil
}

func (f fakeDevtools) ProjectIndexWatchStatus(context.Context) (api.ProjectIndexWatchStatus, error) {
	if f.watch.State != "" {
		return f.watch, nil
	}
	return api.ProjectIndexWatchStatus{State: "idle"}, nil
}

func (f *fakeDevtools) Get(_ context.Context, path string, query url.Values) (any, bool, error) {
	f.lastPath = path
	f.lastQuery = query
	value, ok := f.values[path]
	return value, ok, nil
}

func TestProjectIndexEndpointUsesDevtoolsReadPort(t *testing.T) {
	description := "Prompt one"
	systemTemplate := "system"
	promptTemplate := "prompt"
	want := api.IndexData{
		SchemaVersion: 1,
		Prompts: []api.PromptMeta{
			{
				ID:             "prompt-1",
				Description:    &description,
				Tags:           []string{"draft"},
				HasOutput:      true,
				Settings:       json.RawMessage(`{"temperature":0.2}`),
				SystemTemplate: &systemTemplate,
				PromptTemplate: &promptTemplate,
			},
		},
		Contexts: []api.ContextMeta{
			{ID: "context-1", IsStatic: true, UsedBy: []string{"prompt-1"}},
		},
		Tools: []api.ToolMeta{
			{Name: "lookup", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
	}

	got, err := ProjectIndex.Call(context.Background(), Deps{
		Devtools: &fakeDevtools{index: want},
	})
	if err != nil {
		t.Fatalf("ProjectIndex.Call: %v", err)
	}
	if got.Prompts[0].ID != want.Prompts[0].ID {
		t.Fatalf("prompt ID = %q, want %q", got.Prompts[0].ID, want.Prompts[0].ID)
	}
	if !got.Prompts[0].HasOutput || string(got.Prompts[0].Settings) != `{"temperature":0.2}` {
		t.Fatalf("prompt details = %+v, want hasOutput and settings", got.Prompts[0])
	}
	if !got.Contexts[0].IsStatic || got.Contexts[0].UsedBy[0] != "prompt-1" {
		t.Fatalf("context details = %+v, want static context used by prompt-1", got.Contexts[0])
	}
	if string(got.Tools[0].InputSchema) != `{"type":"object"}` {
		t.Fatalf("tool input schema = %s, want object schema", got.Tools[0].InputSchema)
	}
}

func TestProjectIndexWatchEndpointUsesDevtoolsReadPort(t *testing.T) {
	want := api.ProjectIndexWatchStatus{
		State: "idle",
		LastRun: &api.ProjectIndexWatchRunInfo{
			RunID:            42,
			Status:           "semantic-ready",
			PlanKind:         "source-file-reindex",
			ChangedFileCount: 1,
			SemanticStatus:   "ready",
		},
	}

	got, err := ProjectIndexWatch.Call(context.Background(), Deps{
		Devtools: fakeDevtools{watch: want},
	})
	if err != nil {
		t.Fatalf("ProjectIndexWatch.Call: %v", err)
	}
	if got.LastRun == nil || got.LastRun.RunID != 42 || got.LastRun.SemanticStatus != "ready" {
		t.Fatalf("watch status = %+v, want forwarded status", got)
	}
}
