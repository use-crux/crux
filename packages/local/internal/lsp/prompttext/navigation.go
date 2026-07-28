package prompttext

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type navigationItem struct {
	location    protocol.Location
	stableID    string
	declaration bool
}

func navigationAt(
	view *promptview.View,
	analysis staticprotocol.PromptTextQueryResponse,
	file string,
	position protocol.Position,
	includeDeclaration bool,
) NavigationResult {
	refs := refsAt(view, file, position)
	if len(refs) == 0 {
		return NavigationResult{
			Handled:    syntaxRecognizesPosition(analysis, position),
			References: []protocol.Location{},
		}
	}
	result := NavigationResult{Handled: true, References: []protocol.Location{}}
	if analysis.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return result
	}
	template, ok := uniqueSyntaxTemplate(analysis.Templates, refs[0].Template.Range)
	if !ok || !sameTemplateRange(refs) || !claimsPromptTextPosition(template, position) {
		return result
	}
	result.Claimed = true
	owners := occurrenceOwners(view, refs)
	if len(owners) == 1 {
		if definition, found := definitionByID(view, owners[0]); found {
			location := protocolLocation(definition.Location)
			if !locationContainsPosition(location, position, file) {
				result.Definition = &location
			}
		}
	}
	result.References = navigationReferences(
		view,
		refs,
		owners,
		includeDeclaration,
	)
	return result
}

func syntaxRecognizesPosition(
	analysis staticprotocol.PromptTextQueryResponse,
	position protocol.Position,
) bool {
	if analysis.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return false
	}
	for _, template := range analysis.Templates {
		if containsPosition(editorRange(template.Range), position) {
			return true
		}
	}
	return false
}

func refsAt(
	view *promptview.View,
	file string,
	position protocol.Position,
) []promptview.PromptTextSourceRef {
	if view == nil {
		return nil
	}
	result := make([]promptview.PromptTextSourceRef, 0)
	for _, ref := range view.PromptTextRefs {
		if ref.Template.File == file && containsPosition(ref.Template.Range, position) {
			result = append(result, ref)
		}
	}
	return result
}

func uniqueSyntaxTemplate(
	templates []staticprotocol.PromptTextTemplate,
	source protocol.Range,
) (staticprotocol.PromptTextTemplate, bool) {
	var result staticprotocol.PromptTextTemplate
	matches := 0
	for _, template := range templates {
		if editorRange(template.Range) == source {
			result = template
			matches++
		}
	}
	return result, matches == 1
}

func sameTemplateRange(refs []promptview.PromptTextSourceRef) bool {
	for _, ref := range refs[1:] {
		if ref.Template != refs[0].Template {
			return false
		}
	}
	return true
}

func claimsPromptTextPosition(
	template staticprotocol.PromptTextTemplate,
	position protocol.Position,
) bool {
	if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return false
	}
	for _, barrier := range template.InterpolationBarriers {
		if containsPosition(editorRange(barrier.Range), position) {
			return false
		}
	}
	for _, backtick := range template.BacktickRanges {
		if containsPosition(editorRange(backtick), position) {
			return true
		}
	}
	open, close := editorRange(template.BacktickRanges[0]), editorRange(template.BacktickRanges[1])
	return compareEditorPosition(open.End, position) <= 0 &&
		compareEditorPosition(position, close.Start) < 0
}

func occurrenceOwners(
	view *promptview.View,
	refs []promptview.PromptTextSourceRef,
) []string {
	owners := make(map[string]struct{})
	for _, ref := range refs {
		if ref.SourceKind == promptview.PromptTextSourceOwner {
			owners[ref.Key.DefinitionID] = struct{}{}
			continue
		}
		joined := false
		for _, join := range view.FragmentJoins {
			if join.Key.DefinitionID == ref.Key.DefinitionID &&
				join.Key.TargetSourceRefID == ref.Key.SourceRefID &&
				join.TargetTemplate == ref.Template {
				owners[join.Key.DefinitionID] = struct{}{}
				joined = true
			}
		}
		if !joined {
			owners[ref.Key.DefinitionID] = struct{}{}
		}
	}
	result := make([]string, 0, len(owners))
	for id := range owners {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func definitionByID(
	view *promptview.View,
	id string,
) (promptview.Definition, bool) {
	for _, definition := range view.Definitions {
		if definition.ID == id {
			return definition, true
		}
	}
	return promptview.Definition{}, false
}

func containsPosition(source protocol.Range, position protocol.Position) bool {
	return compareEditorPosition(source.Start, position) <= 0 &&
		compareEditorPosition(position, source.End) < 0
}

func protocolLocation(source promptview.Location) protocol.Location {
	return protocol.Location{
		URI:   protocol.DocumentURI(mapping.FileURI("", source.File)),
		Range: source.Range,
	}
}

func locationContainsPosition(
	location protocol.Location,
	position protocol.Position,
	file string,
) bool {
	return location.URI == protocol.DocumentURI(mapping.FileURI("", file)) &&
		(containsPosition(location.Range, position) ||
			location.Range.Start == location.Range.End &&
				location.Range.Start == position)
}
