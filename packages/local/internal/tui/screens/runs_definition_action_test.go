package screens

import (
	"context"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
)

func TestRunsDefinitionActionUsesExactDistinctRuntimeReferences(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-definition"})
	selectRunForTest(runs, "run-definition")

	action := runsActionByID(t, runs.Actions(context.Background(), nil), "runs.definition")
	if action.Enabled() || action.DisabledReason != "no definition references" {
		t.Fatalf("zero-reference action = enabled %v, reason %q", action.Enabled(), action.DisabledReason)
	}

	firstSource := &observability.SanitizedSourceRef{File: "src/agent.ts", Line: 12}
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-definition"},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
		DefinitionRefs: []observability.DefinitionRef{{
			ID: "agent:shared-name", Kind: "agent", Role: "invoke", Source: firstSource,
		}},
	})
	action = runsActionByID(t, runs.Actions(context.Background(), nil), "runs.definition")
	message := action.Run()()
	if got, want := message, (NavigateRequest{NavID: "index", Kind: "definition", ID: "agent:shared-name"}); got != want {
		t.Fatalf("one-reference action = %#v, want %#v", got, want)
	}

	secondSource := &observability.SanitizedSourceRef{File: "src/prompt.ts", Line: 24, Column: 3}
	repeatedSource := &observability.SanitizedSourceRef{File: "src/agent-call.ts", Line: 31}
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-definition"},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
		DefinitionRefs: []observability.DefinitionRef{
			{ID: "agent:shared-name", Kind: "agent", Role: "invoke", Source: firstSource},
			{ID: "agent:shared-name", Kind: "agent", Role: "route", Source: repeatedSource},
			{ID: "prompt:shared-name", Kind: "prompt", Role: "resolve", Source: secondSource},
		},
	})
	action = runsActionByID(t, runs.Actions(context.Background(), nil), "runs.definition")
	request, ok := action.Run()().(ChooseDefinitionRequest)
	if !ok {
		t.Fatalf("multiple-reference action message = %T, want ChooseDefinitionRequest", action.Run()())
	}
	want := []DefinitionChoice{
		{ID: "agent:shared-name", References: []observability.DefinitionRef{
			{ID: "agent:shared-name", Kind: "agent", Role: "invoke", Source: firstSource},
			{ID: "agent:shared-name", Kind: "agent", Role: "route", Source: repeatedSource},
		}},
		{ID: "prompt:shared-name", References: []observability.DefinitionRef{
			{ID: "prompt:shared-name", Kind: "prompt", Role: "resolve", Source: secondSource},
		}},
	}
	if !reflect.DeepEqual(request.Choices, want) {
		t.Fatalf("definition choices mismatch:\n got %#v\nwant %#v", request.Choices, want)
	}
}

func TestRunsDefinitionActionScopesSpanChoicesToSelectedActivityAndDetails(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-span-definition"})
	selectRunForTest(runs, "run-span-definition")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-span-definition"},
		DefinitionRefs: []observability.DefinitionRef{
			{ID: "agent:run-only", Kind: "agent", Role: "invoke"},
		},
		Root: api.ObservabilityRunDetailNode{
			ID:          "root",
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "span:selected"},
			DefinitionRefs: []observability.DefinitionRef{
				{ID: "tool:selected", Kind: "tool", Role: "call"},
			},
			Details: []api.ObservabilityRunDetailDetail{{
				ID: "detail:selected", DefinitionRefs: []observability.DefinitionRef{
					{ID: "context:attached", Kind: "context", Role: "inject"},
				},
			}},
			Children: []api.ObservabilityRunDetailNode{{
				ID: "child", SpanSummary: api.ObservabilitySpanSummary{SpanID: "span:child"}, DefinitionRefs: []observability.DefinitionRef{
					{ID: "prompt:child-only", Kind: "prompt", Role: "resolve"},
				},
			}},
		},
	})
	runs.setFocus(focusWaterfall)
	selectSpanForTest(runs, "span:selected")

	action := runsActionByID(t, runs.Actions(context.Background(), nil), "runs.definition")
	request, ok := action.Run()().(ChooseDefinitionRequest)
	if !ok {
		t.Fatalf("span definition action message = %T, want chooser", action.Run()())
	}
	got := make([]string, len(request.Choices))
	for index, choice := range request.Choices {
		got[index] = choice.ID
	}
	want := []string{"tool:selected", "context:attached"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("span definition choices = %#v, want selected activity and details %#v", got, want)
	}
}

func runsActionByID(t *testing.T, actions []interaction.Action, id string) interaction.Action {
	t.Helper()
	for _, action := range actions {
		if action.ID == id {
			return action
		}
	}
	t.Fatalf("action %q not found", id)
	return interaction.Action{}
}
