package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type indexDefinitionDocument struct {
	content              string
	sourceLocationAnchor kit.DocumentAnchor
	hasSourceLocation    bool
}

func renderIndexDefinitionDocument(index api.IndexData, definition api.ProjectDefinition) string {
	return buildIndexDefinitionDocument(index, definition).content
}

func buildIndexDefinitionDocument(index api.IndexData, definition api.ProjectDefinition) indexDefinitionDocument {
	lines := make([]string, 0, 32)
	document := indexDefinitionDocument{}
	section := func(title string) { lines = append(lines, " "+shell.SectionTag.Render(title)) }
	field := func(label, value string) {
		if value != "" {
			lines = append(lines, fmt.Sprintf(" %-12s %s", sanitizeIndexInline(label), sanitizeIndexInline(value)))
		}
	}

	section("IDENTITY")
	field("id", definition.ID)
	field("kind", definition.Kind)
	field("name", definition.Name)
	field("description", definition.Description)
	field("path", strings.Join(definition.Path, " › "))
	field("tags", strings.Join(definition.Tags, ", "))
	field("status", definition.Status)
	field("fidelity", definition.Fidelity)
	field("fingerprint", definition.Fingerprint)

	if definition.Source != nil {
		section("SOURCE")
		if location := formatIndexSourceLocation(*definition.Source); location != "" {
			document.sourceLocationAnchor = kit.DocumentAnchor{SourceLine: len(lines)}
			document.hasSourceLocation = true
			field("location", location)
		}
	}
	if snippet := definition.SourceSnippet; snippet != nil {
		section("SOURCE SNIPPET")
		field("language", snippet.Language)
		field("range", formatIndexSourceRange(snippet.Range))
		if snippet.Truncated {
			field("status", "truncated by indexer")
		}
		lines = append(lines, strings.Split(sanitizeIndexMultiline(snippet.Source), "\n")...)
	}

	if len(definition.SourceRefs) > 0 {
		section("SOURCE REFERENCES")
		for _, ref := range definition.SourceRefs {
			field("reference", ref.ID)
			field(ref.Role, formatIndexSourceReference(ref))
			field("description", ref.Description)
			if ref.Snippet != nil {
				field("language", ref.Snippet.Language)
				field("snippet range", formatIndexSourceRange(ref.Snippet.Range))
				if ref.Snippet.Truncated {
					field("status", "truncated by indexer")
				}
				lines = append(lines, strings.Split(sanitizeIndexMultiline(ref.Snippet.Source), "\n")...)
			}
		}
	}

	for _, finding := range activeLintFindingsForDefinition(index, definition.ID) {
		section("LINT")
		field(finding.RuleID, strings.TrimSpace(finding.Severity+" · "+finding.Title))
		field("message", finding.Message)
		field("why", finding.Rationale)
		field("impact", finding.Impact)
		field("docs", finding.DocsURL)
	}

	for _, relation := range index.Relations {
		if relation.From != definition.ID && relation.To != definition.ID {
			continue
		}
		section("RELATION")
		field(relation.Type, relation.From+" → "+relation.To)
		field("fidelity", relation.Fidelity)
		if relation.Source != nil {
			field("source", formatIndexSourceLocation(*relation.Source))
		}
	}

	for _, diagnostic := range index.Diagnostics {
		if !stringSliceContains(diagnostic.RelatedDefinitionIDs, definition.ID) {
			continue
		}
		section("DIAGNOSTIC")
		field(diagnostic.Code, strings.TrimSpace(diagnostic.Severity+" · "+diagnostic.Message))
		field("fix", diagnostic.SuggestedFix)
		if diagnostic.Source != nil {
			field("source", formatIndexSourceLocation(*diagnostic.Source))
		}
	}

	document.content = strings.Join(lines, "\n")
	return document
}

func formatIndexSourceLocation(source api.SourceLoc) string {
	location := source.File
	if source.Line > 0 {
		location += fmt.Sprintf(":%d", source.Line)
		if source.Column != nil {
			location += fmt.Sprintf(":%d", *source.Column)
		}
	}
	if source.Function != "" {
		location += " · " + source.Function
	}
	return location
}

func formatIndexSourceRange(source api.SourceRange) string {
	start := source.File
	if source.StartLine > 0 {
		start += fmt.Sprintf(":%d", source.StartLine)
		if source.StartColumn != nil {
			start += fmt.Sprintf(":%d", *source.StartColumn)
		}
	}
	if source.EndLine == nil {
		return start
	}
	end := fmt.Sprintf("%d", *source.EndLine)
	if source.EndColumn != nil {
		end += fmt.Sprintf(":%d", *source.EndColumn)
	}
	return start + "–" + end
}

func formatIndexSourceReference(ref api.ProjectSourceRef) string {
	parts := []string{formatIndexSourceLocation(ref.Source)}
	for _, part := range []string{ref.Property, ref.Symbol, ref.Fidelity} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, " · ")
}
