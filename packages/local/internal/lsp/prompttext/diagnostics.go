package prompttext

import (
	"context"
	"encoding/json"
	"regexp"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

var promptTextDiagnosticIDPattern = regexp.MustCompile(
	`^prompt-text:[0-9a-f]{64}$`,
)

// DiagnosticResult is one exact current diagnostic contribution. ViewStamp
// lets the server reject a result after any coherent publication change.
type DiagnosticResult struct {
	Revision    transient.Revision
	ViewStamp   indexview.ViewStamp
	Diagnostics []protocol.Diagnostic
	matches     []diagnosticMatch
}

type diagnosticMatch struct {
	diagnostic        protocol.Diagnostic
	indexDiagnostic   api.IndexDiagnostic
	evidence          store.PromptTextDiagnosticEvidence
	tagExpression     string
	expressionText    string
	expressionUnique  bool
	lineIsolationEdit *protocol.TextEdit
}

// Diagnostics joins saved semantic conclusions to exact transient template
// and interpolation ranges. Every failure returns a nonnil empty lane.
func (c *Controller) Diagnostics(
	ctx context.Context,
	request Request,
) DiagnosticResult {
	document, analysis, view, ok := c.currentDiagnosticContext(ctx, request)
	empty := DiagnosticResult{
		Revision: document.Revision, Diagnostics: []protocol.Diagnostic{},
	}
	if !ok {
		return empty
	}
	empty.ViewStamp = view.Stamp
	matches := joinedPromptTextDiagnostics(
		view.Publication,
		request.Root,
		request.File,
		document.Text,
		analysis,
	)
	diagnostics := make([]protocol.Diagnostic, 0, len(matches))
	for _, match := range matches {
		diagnostics = append(diagnostics, match.diagnostic)
	}
	return DiagnosticResult{
		Revision: document.Revision, ViewStamp: view.Stamp,
		Diagnostics: sortedProtocolDiagnostics(diagnostics), matches: matches,
	}
}

// DiagnosticResultCurrent performs the final document and complete-view-stamp
// recheck immediately before a server publishes a previously joined result.
func (c *Controller) DiagnosticResultCurrent(
	request Request,
	result DiagnosticResult,
) bool {
	if c == nil || c.documents == nil {
		return false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || document.Revision != result.Revision {
		return false
	}
	selection := currentSemanticView(request, document)
	return selection.Status == indexview.ViewStatusExact &&
		selection.View != nil &&
		selection.View.Stamp == result.ViewStamp
}

func (c *Controller) currentDiagnosticContext(
	ctx context.Context,
	request Request,
) (
	transient.Document,
	readmodel.PromptTextResult,
	*indexview.ProjectIndexView,
	bool,
) {
	if c == nil || c.documents == nil || c.coordinator == nil || ctx.Err() != nil {
		return transient.Document{}, readmodel.PromptTextResult{}, nil, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || request.Views == nil || request.Analyzer == nil {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	selection := currentSemanticView(request, document)
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	fragments, fragmentJoins := semanticPreviewEvidence(
		selection.View.Publication, request.Root, request.File, document.Text,
	)
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Revision,
		Fragments:      fragments, FragmentJoins: fragmentJoins,
		Analyzer: request.Analyzer,
	})
	if err != nil || ctx.Err() != nil || analysis.Revision != document.Revision ||
		analysis.Result.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	return document, analysis.Result, selection.View, true
}

func joinedPromptTextDiagnostics(
	publication readmodel.Publication,
	root, file, text string,
	analysis readmodel.PromptTextResult,
) []diagnosticMatch {
	diagnostics := diagnosticsForFile(publication, root, file)
	result := make([]diagnosticMatch, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		match, ok := joinPromptTextDiagnostic(
			publication, diagnostic, root, file, text, analysis,
		)
		if ok {
			result = append(result, match)
		}
	}
	return result
}

func joinPromptTextDiagnostic(
	publication readmodel.Publication,
	diagnostic api.IndexDiagnostic,
	root, file, text string,
	analysis readmodel.PromptTextResult,
) (diagnosticMatch, bool) {
	evidence, ok := decodePromptTextDiagnosticEvidence(diagnostic)
	if !ok || !promptTextDiagnosticIDPattern.MatchString(diagnostic.ID) ||
		evidence.Proof != "semantic-exact" ||
		!promptTextDiagnosticCauseMatchesCode(evidence.Cause, diagnostic.Code) ||
		diagnostic.Message != promptTextDiagnosticMessage(evidence) ||
		diagnostic.Severity != "error" || diagnostic.Source == nil ||
		diagnostic.SuggestedFix != "" ||
		len(diagnostic.RelatedDefinitionIDs) != 1 ||
		!sourceRowContainsDiagnostic(publication, root, file, diagnostic.ID) {
		return diagnosticMatch{}, false
	}
	sourceRef, ok := uniqueDiagnosticSourceRef(
		publication,
		diagnostic.RelatedDefinitionIDs[0],
		evidence.SourceRefID,
		root,
		file,
		text,
	)
	if !ok {
		return diagnosticMatch{}, false
	}
	sourceRange, _, _, _ := exactSourceRange(sourceRef.Snippet.Range, text)
	template, ok := uniqueDiagnosticTemplate(analysis, sourceRange)
	if !ok {
		return diagnosticMatch{}, false
	}
	barrier, ok := uniqueInterpolationBarrier(
		template.InterpolationBarriers,
		uint32(evidence.InterpolationIndex),
	)
	if !ok || !diagnosticSourceMatches(
		*diagnostic.Source, root, file, text, barrier.ExpressionRange.Start,
	) {
		return diagnosticMatch{}, false
	}
	tagExpression, tagOK := textForPromptRange(text, template.TagRange)
	expressionText, expressionOK := textForPromptRange(text, barrier.ExpressionRange)
	if !tagOK || !expressionOK || tagExpression == "" || expressionText == "" {
		return diagnosticMatch{}, false
	}
	data, err := json.Marshal(struct {
		Kind string `json:"kind"`
		ID   string `json:"id"`
	}{Kind: "prompt-text", ID: diagnostic.ID})
	if err != nil {
		return diagnosticMatch{}, false
	}
	mapped := protocol.Diagnostic{
		Range: editorRange(barrier.ExpressionRange), Severity: protocol.SeverityError,
		Code: protocol.DiagnosticCode(diagnostic.Code), Source: "crux",
		Message: diagnostic.Message, Data: data,
	}
	return diagnosticMatch{
		diagnostic: mapped, indexDiagnostic: diagnostic, evidence: evidence,
		tagExpression: tagExpression, expressionText: expressionText,
		expressionUnique: uniqueBarrierExpressionRange(
			template.InterpolationBarriers, barrier,
		),
		lineIsolationEdit: validatedLineIsolationEdit(
			text, template, barrier,
		),
	}, true
}

func decodePromptTextDiagnosticEvidence(
	diagnostic api.IndexDiagnostic,
) (store.PromptTextDiagnosticEvidence, bool) {
	if len(diagnostic.Evidence) == 0 {
		return store.PromptTextDiagnosticEvidence{}, false
	}
	var evidence store.PromptTextDiagnosticEvidence
	if json.Unmarshal(diagnostic.Evidence, &evidence) != nil {
		return store.PromptTextDiagnosticEvidence{}, false
	}
	return evidence, true
}

func promptTextDiagnosticCauseMatchesCode(
	cause store.PromptTextDiagnosticCause,
	code string,
) bool {
	switch cause.Kind {
	case "invalid-interpolation":
		return code == "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION"
	case "json-serialization":
		return code == "CRUX_PROMPT_TEXT_JSON_SERIALIZATION"
	case "inline-sequence":
		return code == "CRUX_PROMPT_TEXT_INLINE_SEQUENCE"
	default:
		return false
	}
}
