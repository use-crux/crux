package screens

import (
	"fmt"
	"path/filepath"
	"strings"

	"charm.land/lipgloss/v2"
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
	return buildIndexDefinitionDocument(index, definition, 80).content
}

func buildIndexDefinitionDocument(index api.IndexData, definition api.ProjectDefinition, width int) indexDefinitionDocument {
	if width <= 0 {
		width = 80
	}
	projectRoot := index.ProjectRoot
	if projectRoot == "" && index.Project != nil {
		projectRoot = index.Project.Root
	}
	lines := make([]string, 0, 32)
	document := indexDefinitionDocument{}
	section := func(title string) { lines = append(lines, " "+shell.SectionTag.Render(title)) }
	field := func(label, value string) {
		if value != "" {
			rows := strings.TrimRight(labelValueRows(label, value, width, shell.ColorText), "\n")
			lines = append(lines, strings.Split(rows, "\n")...)
		}
	}
	pathWidth := max(1, width-16)

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
		if location := formatIndexSourceLocation(projectRoot, *definition.Source, pathWidth); location != "" {
			document.sourceLocationAnchor = kit.DocumentAnchor{SourceLine: len(lines)}
			document.hasSourceLocation = true
			field("location", location)
		}
	}
	if snippet := definition.SourceSnippet; snippet != nil {
		section("SOURCE SNIPPET")
		field("language", snippet.Language)
		field("range", formatIndexSourceRange(projectRoot, snippet.Range, pathWidth))
		if snippet.Truncated {
			field("status", "truncated by indexer")
		}
		lines = append(lines, strings.Split(sanitizeIndexMultiline(snippet.Source), "\n")...)
	}

	if len(definition.SourceRefs) > 0 {
		section("SOURCE REFERENCES")
		for _, ref := range definition.SourceRefs {
			field("reference", ref.ID)
			field(ref.Role, formatIndexSourceReference(projectRoot, ref, pathWidth))
			field("description", ref.Description)
			if ref.Snippet != nil {
				field("language", ref.Snippet.Language)
				field("snippet range", formatIndexSourceRange(projectRoot, ref.Snippet.Range, pathWidth))
				if ref.Snippet.Truncated {
					field("status", "truncated by indexer")
				}
				lines = append(lines, strings.Split(sanitizeIndexMultiline(ref.Snippet.Source), "\n")...)
			}
		}
	}

	for _, finding := range activeLintFindingsForDefinition(index, definition.ID) {
		section("LINT")
		field("rule", strings.TrimSpace(finding.RuleID+" · "+finding.Severity+" · "+finding.Title))
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
			field("source", formatIndexSourceLocation(projectRoot, *relation.Source, pathWidth))
		}
	}

	for _, diagnostic := range index.Diagnostics {
		if !stringSliceContains(diagnostic.RelatedDefinitionIDs, definition.ID) {
			continue
		}
		section("DIAGNOSTIC")
		field("diagnostic", strings.TrimSpace(diagnostic.Code+" · "+diagnostic.Severity+" · "+diagnostic.Message))
		field("fix", diagnostic.SuggestedFix)
		if diagnostic.Source != nil {
			field("source", formatIndexSourceLocation(projectRoot, *diagnostic.Source, pathWidth))
		}
	}

	document.content = strings.Join(lines, "\n")
	return document
}

func formatIndexSourceLocation(projectRoot string, source api.SourceLoc, width int) string {
	position := ""
	if source.Line > 0 {
		position += fmt.Sprintf(":%d", source.Line)
		if source.Column != nil {
			position += fmt.Sprintf(":%d", *source.Column)
		}
	}
	metadata := ""
	if source.Function != "" {
		metadata = " · " + source.Function
	}
	return formatIndexPath(projectRoot, source.File, position, metadata, width)
}

func formatIndexSourceRange(projectRoot string, source api.SourceRange, width int) string {
	position := ""
	if source.StartLine > 0 {
		position += fmt.Sprintf(":%d", source.StartLine)
		if source.StartColumn != nil {
			position += fmt.Sprintf(":%d", *source.StartColumn)
		}
	}
	if source.EndLine == nil {
		return formatIndexPath(projectRoot, source.File, position, "", width)
	}
	end := fmt.Sprintf("%d", *source.EndLine)
	if source.EndColumn != nil {
		end += fmt.Sprintf(":%d", *source.EndColumn)
	}
	return formatIndexPath(projectRoot, source.File, position+"–"+end, "", width)
}

func formatIndexSourceReference(projectRoot string, ref api.ProjectSourceRef, width int) string {
	parts := make([]string, 0, 3)
	for _, part := range []string{ref.Property, ref.Symbol, ref.Fidelity} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	metadata := ""
	if len(parts) > 0 {
		metadata = " · " + strings.Join(parts, " · ")
	}
	position := ""
	if ref.Source.Line > 0 {
		position = fmt.Sprintf(":%d", ref.Source.Line)
		if ref.Source.Column != nil {
			position += fmt.Sprintf(":%d", *ref.Source.Column)
		}
	}
	return formatIndexPath(projectRoot, ref.Source.File, position, metadata, width)
}

func formatIndexPath(projectRoot, file, position, metadata string, width int) string {
	path := projectRelativeIndexPath(projectRoot, file)
	full := path + position + metadata
	if width <= 0 || lipgloss.Width(full) <= width {
		return full
	}

	core := path + position
	if lipgloss.Width(core) <= width {
		return full
	}

	base := filepath.Base(filepath.FromSlash(path)) + position
	pathWidth := width
	if lipgloss.Width(path+position) <= pathWidth {
		return path + position + metadata
	}
	if lipgloss.Width(base) >= pathWidth {
		return kit.TruncateMiddle(base, pathWidth, "…") + metadata
	}

	const middle = "…/"
	prefixWidth := max(0, pathWidth-lipgloss.Width(base)-lipgloss.Width(middle))
	dir := strings.TrimSuffix(filepath.ToSlash(filepath.Dir(filepath.FromSlash(path))), ".")
	dir = strings.TrimSuffix(dir, "/")
	prefix := kit.Truncate(dir, prefixWidth, "")
	return prefix + middle + base + metadata
}

func projectRelativeIndexPath(projectRoot, file string) string {
	if file == "" {
		return ""
	}
	cleanFile := filepath.Clean(file)
	if projectRoot != "" && filepath.IsAbs(cleanFile) {
		if relative, err := filepath.Rel(filepath.Clean(projectRoot), cleanFile); err == nil &&
			relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			cleanFile = relative
		}
	}
	return filepath.ToSlash(cleanFile)
}
