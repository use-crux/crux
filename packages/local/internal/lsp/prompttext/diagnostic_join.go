package prompttext

import (
	"encoding/json"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func diagnosticsForFile(
	publication readmodel.Publication,
	root, file string,
) []api.IndexDiagnostic {
	var result []api.IndexDiagnostic
	matched := false
	for rowFile, diagnostics := range publication.Diagnostics {
		if !sameFile(root, rowFile, file) {
			continue
		}
		if matched {
			return nil
		}
		matched = true
		result = diagnostics
	}
	return result
}

func uniqueDiagnosticSourceRef(
	publication readmodel.Publication,
	definitionID, sourceRefID, root, file, text string,
) (api.ProjectSourceRef, bool) {
	definition, ok := publication.DefinitionsByID[definitionID]
	if !ok {
		return api.ProjectSourceRef{}, false
	}
	var (
		result api.ProjectSourceRef
		count  int
	)
	for _, sourceRef := range definition.SourceRefs {
		if sourceRef.ID != sourceRefID {
			continue
		}
		if sourceRef.Role != sourceRef.Property ||
			(sourceRef.Role != "prompt" && sourceRef.Role != "system") ||
			promptTextLifecycle(sourceRef.Metadata) != "static" {
			return api.ProjectSourceRef{}, false
		}
		if _, ok := canonicalSourceRefRange(
			sourceRef, root, file, text,
		); !ok {
			return api.ProjectSourceRef{}, false
		}
		result = sourceRef
		count++
	}
	return result, count == 1
}

func uniqueDiagnosticTemplate(
	analysis readmodel.PromptTextResult,
	sourceRange protocol.Range,
) (staticprotocol.PromptTextTemplate, bool) {
	var (
		result staticprotocol.PromptTextTemplate
		count  int
	)
	for _, template := range analysis.Templates {
		if editorRange(template.Range) != sourceRange ||
			template.Status.Kind != staticprotocol.PromptTextStatusComplete {
			continue
		}
		result = template
		count++
	}
	return result, count == 1
}

func uniqueInterpolationBarrier(
	barriers []staticprotocol.PromptTextInterpolationBarrier,
	index uint32,
) (staticprotocol.PromptTextInterpolationBarrier, bool) {
	var (
		result staticprotocol.PromptTextInterpolationBarrier
		count  int
	)
	for _, barrier := range barriers {
		if barrier.Index == index {
			result = barrier
			count++
		}
	}
	return result, count == 1 &&
		comparePromptPosition(result.ExpressionRange.Start, result.ExpressionRange.End) < 0
}

func diagnosticSourceMatches(
	source api.SourceLoc,
	root, file, text string,
	start staticprotocol.PromptTextPosition,
) bool {
	if !sameFile(root, source.File, file) || source.Column == nil {
		return false
	}
	position, _, ok := sourcePosition(text, source.Line, *source.Column)
	return ok && position == (protocol.Position{
		Line: start.Line, Character: start.Character,
	})
}

func sourceRowContainsDiagnostic(
	publication readmodel.Publication,
	root, file, diagnosticID string,
) bool {
	count := 0
	for rowFile, source := range publication.SourcesByFile {
		if !sameFile(root, rowFile, file) {
			continue
		}
		if !sameFile(root, source.File, file) {
			return false
		}
		for _, id := range source.Diagnostics {
			if id == diagnosticID {
				count++
			}
		}
	}
	return count == 1
}

func textForPromptRange(
	text string,
	value staticprotocol.PromptTextRange,
) (string, bool) {
	_, start, startOK := sourcePosition(
		text, int(value.Start.Line)+1, int(value.Start.Character)+1,
	)
	_, end, endOK := sourcePosition(
		text, int(value.End.Line)+1, int(value.End.Character)+1,
	)
	if !startOK || !endOK || start >= end {
		return "", false
	}
	return text[start:end], true
}

func sortedProtocolDiagnostics(
	diagnostics []protocol.Diagnostic,
) []protocol.Diagnostic {
	result := append([]protocol.Diagnostic(nil), diagnostics...)
	sort.SliceStable(result, func(left, right int) bool {
		l, r := result[left], result[right]
		if l.Range.Start != r.Range.Start {
			return promptPositionLess(l.Range.Start, r.Range.Start)
		}
		if l.Range.End != r.Range.End {
			return promptPositionLess(l.Range.End, r.Range.End)
		}
		if l.Code != r.Code {
			return l.Code < r.Code
		}
		return promptTextLocatorID(l) < promptTextLocatorID(r)
	})
	if result == nil {
		return []protocol.Diagnostic{}
	}
	return result
}

func promptPositionLess(left, right protocol.Position) bool {
	return left.Line < right.Line ||
		left.Line == right.Line && left.Character < right.Character
}

func promptTextLocatorID(diagnostic protocol.Diagnostic) string {
	var data struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(diagnostic.Data, &data) != nil {
		return ""
	}
	return data.ID
}
