package prompttext

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestPromptTextDiagnosticAndActionRejectDirtySavedIdentity(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	dirty := fixture.document
	dirty.Text = strings.Replace(dirty.Text, "${true}", "${false}", 1)
	dirty.Version++
	dirty.Revision = transient.NewRevision(
		dirty.Revision.OpenEpoch,
		dirty.Version,
		dirty.Text,
	)
	controller := NewController(&fixedDocumentSource{document: dirty})
	fixture.request.Analyzer = panicTransientSource{}

	diagnostics := controller.Diagnostics(context.Background(), fixture.request)
	if diagnostics.Diagnostics == nil || len(diagnostics.Diagnostics) != 0 {
		t.Fatalf("dirty saved diagnostics = %#v, want exact empty lane", diagnostics)
	}
	actions := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if actions.Actions == nil || len(actions.Actions) != 0 {
		t.Fatalf("dirty saved actions = %#v, want none", actions)
	}
}

func TestPromptTextDiagnosticRejectsInexactSemanticOrTransientJoin(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		mutateView func(*indexview.ProjectIndexView)
		mutate     func(*readmodel.PromptTextResult)
	}{
		{
			name: "wrong interpolation index",
			mutate: func(result *readmodel.PromptTextResult) {
				result.Templates[0].InterpolationBarriers[0].Index = 1
			},
		},
		{
			name: "wrong source ref role",
			mutateView: func(view *indexview.ProjectIndexView) {
				definition := view.Publication.DefinitionsByID["prompt:writer"]
				definition.SourceRefs[0].Role = "context"
				view.Publication.DefinitionsByID[definition.ID] = definition
			},
		},
		{
			name: "dynamic lifecycle",
			mutateView: func(view *indexview.ProjectIndexView) {
				definition := view.Publication.DefinitionsByID["prompt:writer"]
				promptText := definition.SourceRefs[0].Metadata["promptText"].(map[string]any)
				promptText["lifecycle"] = "dynamic"
				view.Publication.DefinitionsByID[definition.ID] = definition
			},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			fixture := promptTextInvalidFixture(t)
			if test.mutateView != nil {
				fixture.request.Views = mutatingDiagnosticViewProvider{
					base: fixture.request.Views, mutate: test.mutateView,
				}
			}
			if test.mutate != nil {
				fixture.request.Analyzer = mutatingPromptTextSource{
					result: fixture.analysis, mutate: test.mutate,
				}
			}
			controller := NewController(
				&fixedDocumentSource{document: fixture.document},
			)
			result := controller.Diagnostics(context.Background(), fixture.request)
			if result.Diagnostics == nil || len(result.Diagnostics) != 0 {
				t.Fatalf("diagnostics = %#v, want fail-closed empty lane", result)
			}
		})
	}
}

func TestPromptTextDiagnosticAndActionRejectChangedCompleteViewStamp(t *testing.T) {
	t.Parallel()

	diagnosticFixture := promptTextInvalidFixture(t)
	diagnosticViews := &changingStampViewProvider{
		base: diagnosticFixture.request.Views, changeAfter: 1,
	}
	diagnosticFixture.request.Views = diagnosticViews
	diagnosticController := NewController(
		&fixedDocumentSource{document: diagnosticFixture.document},
	)
	diagnostics := diagnosticController.Diagnostics(
		context.Background(),
		diagnosticFixture.request,
	)
	if len(diagnostics.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v, want initial exact result", diagnostics)
	}
	if diagnosticController.DiagnosticResultCurrent(
		diagnosticFixture.request,
		diagnostics,
	) {
		t.Fatal("changed complete ViewStamp accepted for publication")
	}

	actionFixture := promptTextInvalidFixture(t)
	actionFixture.request.Views = &changingStampViewProvider{
		base: actionFixture.request.Views, changeAfter: 1,
	}
	actionController := NewController(
		&fixedDocumentSource{document: actionFixture.document},
	)
	actions := actionController.Actions(context.Background(), ActionRequest{
		Request: actionFixture.request, DiagnosticID: actionFixture.diagnosticID,
		DiagnosticRange: actionFixture.expressionRange,
		RequestRange:    actionFixture.expressionRange,
	})
	if len(actions.Actions) != 0 {
		t.Fatalf("changed-view actions = %#v, want none", actions.Actions)
	}
}

func TestPromptTextActionFinalRecheckRejectsLateViewChange(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	fixture.request.Views = &changingStampViewProvider{
		base: fixture.request.Views, changeAfter: 2,
	}
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 1 {
		t.Fatalf("initial actions = %#v, want one", result.Actions)
	}
	if controller.ActionResultCurrent(fixture.request, result) {
		t.Fatal("late complete ViewStamp change passed final action recheck")
	}
}

func TestPromptTextJsonSerializationDiagnosticPublishesWithoutAction(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	fixture.request.Views = mutatingDiagnosticViewProvider{
		base: fixture.request.Views,
		mutate: func(view *indexview.ProjectIndexView) {
			diagnostics := view.Publication.Diagnostics[fixture.request.File]
			diagnostic := diagnostics[0]
			diagnostic.Code = "CRUX_PROMPT_TEXT_JSON_SERIALIZATION"
			diagnostic.Message = "md.json() cannot produce text because JSON.stringify() is proven to return undefined for this value."
			diagnostic.Evidence = json.RawMessage(`{
				"kind":"prompt-text",
				"sourceRefId":"prompt:writer:source:prompt",
				"interpolationIndex":0,
				"proof":"semantic-exact",
				"cause":{"kind":"json-serialization","reason":"undefined-result"}
			}`)
			diagnostics[0] = diagnostic
			view.Publication.Diagnostics[fixture.request.File] = diagnostics
		},
	}
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	diagnostics := controller.Diagnostics(context.Background(), fixture.request)
	if len(diagnostics.Diagnostics) != 1 ||
		diagnostics.Diagnostics[0].Code !=
			"CRUX_PROMPT_TEXT_JSON_SERIALIZATION" {
		t.Fatalf("JSON diagnostics = %#v, want exact explanation", diagnostics)
	}
	actions := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(actions.Actions) != 0 {
		t.Fatalf("JSON serialization actions = %#v, want none", actions.Actions)
	}
}

type mutatingDiagnosticViewProvider struct {
	base   indexview.ViewProvider
	mutate func(*indexview.ProjectIndexView)
}

func (p mutatingDiagnosticViewProvider) BestAvailableView(
	request indexview.ViewRequest,
) indexview.ViewSelection {
	selection := p.base.BestAvailableView(request)
	if selection.View != nil {
		p.mutate(selection.View)
	}
	return selection
}

type changingStampViewProvider struct {
	base        indexview.ViewProvider
	calls       int
	changeAfter int
}

func (p *changingStampViewProvider) BestAvailableView(
	request indexview.ViewRequest,
) indexview.ViewSelection {
	p.calls++
	selection := p.base.BestAvailableView(request)
	if p.calls > p.changeAfter && selection.View != nil {
		selection.View.Stamp.Revision++
	}
	return selection
}

type mutatingPromptTextSource struct {
	result readmodel.PromptTextResult
	mutate func(*readmodel.PromptTextResult)
}

func (s mutatingPromptTextSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s mutatingPromptTextSource) PromptText(
	context.Context,
	readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mutate(&s.result)
	return s.result, nil
}
