package screens

import (
	"fmt"
	"image/color"
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
	lintAnchor           kit.DocumentAnchor
	hasLint              bool
	relationAnchor       kit.DocumentAnchor
	hasRelation          bool
}

func renderIndexDefinitionDocument(index api.IndexData, definition api.ProjectDefinition) string {
	return buildIndexDefinitionDocument(index, definition, 80).content
}

func buildIndexDefinitionDocument(index api.IndexData, definition api.ProjectDefinition, width int) indexDefinitionDocument {
	return buildIndexDefinitionDocumentWithOptions(index, definition, width, indexDefinitionDetailOptions{})
}

type indexDefinitionDetailOptions struct {
	activity       api.CatalogRuntimeActivityV1
	showSuppressed bool
	relationCursor int
}

type indexDocumentBuilder struct {
	index       api.IndexData
	definition  api.ProjectDefinition
	width       int
	pathWidth   int
	projectRoot string
	lines       []string
	document    indexDefinitionDocument
}

func buildIndexDefinitionDocumentWithOptions(
	index api.IndexData,
	definition api.ProjectDefinition,
	width int,
	options indexDefinitionDetailOptions,
) indexDefinitionDocument {
	if width <= 0 {
		width = 80
	}
	projectRoot := index.ProjectRoot
	if projectRoot == "" && index.Project != nil {
		projectRoot = index.Project.Root
	}
	builder := &indexDocumentBuilder{
		index: index, definition: definition, width: width,
		pathWidth: max(1, width-16), projectRoot: projectRoot,
		lines: make([]string, 0, 64),
	}

	builder.renderHero()
	builder.renderIdentity(options.activity)
	builder.renderSchemas()
	builder.renderPromptText()
	builder.renderSources()
	builder.renderLint(options.showSuppressed)
	builder.renderRelations(options.relationCursor)
	builder.renderDiagnostics()

	builder.document.content = strings.Join(builder.lines, "\n")
	return builder.document
}

func (b *indexDocumentBuilder) section(title string) {
	b.lines = append(b.lines, " "+shell.SectionTag.Render(title))
}

func (b *indexDocumentBuilder) field(label, value string) {
	b.fieldTone(label, value, shell.ColorText)
}

func (b *indexDocumentBuilder) fieldTone(label, value string, tone color.Color) {
	if value == "" {
		return
	}
	rows := strings.TrimRight(labelValueRows(label, value, b.width, tone), "\n")
	b.lines = append(b.lines, strings.Split(rows, "\n")...)
}

func (b *indexDocumentBuilder) renderIdentity(activity api.CatalogRuntimeActivityV1) {
	definition := b.definition
	b.section("IDENTITY")
	b.field("id", definition.ID)
	b.field("kind", definition.Kind)
	b.field("name", definition.Name)
	b.field("description", definition.Description)
	b.field("path", strings.Join(definition.Path, " › "))
	b.field("tags", strings.Join(definition.Tags, ", "))
	b.field("status", definition.Status)
	b.field("fidelity", definition.Fidelity)
	b.field("fingerprint", definition.Fingerprint)
	if activity.DefinitionID == definition.ID && activity.RunCount > 0 {
		b.fieldTone("runtime", formatDefinitionActivity(activity), definitionActivityTone(activity.LastStatus))
	}
}

func (b *indexDocumentBuilder) renderSources() {
	definition := b.definition
	if definition.Source != nil {
		b.section("SOURCE")
		if location := formatIndexSourceLocation(b.projectRoot, *definition.Source, b.pathWidth); location != "" {
			b.document.sourceLocationAnchor = kit.DocumentAnchor{SourceLine: len(b.lines)}
			b.document.hasSourceLocation = true
			b.field("location", location)
		}
	}
	if snippet := definition.SourceSnippet; snippet != nil {
		b.section("SOURCE SNIPPET")
		b.field("language", snippet.Language)
		b.field("range", formatIndexSourceRange(b.projectRoot, snippet.Range, b.pathWidth))
		if snippet.Truncated {
			b.field("status", "truncated by indexer")
		}
		b.lines = append(b.lines, highlightedIndexSnippet(snippet.Source, snippet.Language)...)
	}

	if len(definition.SourceRefs) > 0 {
		b.section("SOURCE REFERENCES")
		for _, ref := range definition.SourceRefs {
			b.field("reference", ref.ID)
			b.field(ref.Role, formatIndexSourceReference(b.projectRoot, ref, b.pathWidth))
			b.field("description", ref.Description)
			if ref.Snippet != nil {
				b.field("language", ref.Snippet.Language)
				b.field("snippet range", formatIndexSourceRange(b.projectRoot, ref.Snippet.Range, b.pathWidth))
				if ref.Snippet.Truncated {
					b.field("status", "truncated by indexer")
				}
				b.lines = append(b.lines, highlightedIndexSnippet(ref.Snippet.Source, ref.Snippet.Language)...)
			}
		}
	}
}

func highlightedIndexSnippet(source, language string) []string {
	safe := sanitizeIndexMultiline(source)
	if language == "" {
		language = "TypeScript"
	}
	return strings.Split(kit.HighlightCode(safe, language, codeStyles), "\n")
}

func (b *indexDocumentBuilder) renderDiagnostics() {
	for _, diagnostic := range b.index.Diagnostics {
		if !stringSliceContains(diagnostic.RelatedDefinitionIDs, b.definition.ID) {
			continue
		}
		b.section("DIAGNOSTIC")
		b.field("diagnostic", strings.TrimSpace(diagnostic.Code+" · "+diagnostic.Severity+" · "+diagnostic.Message))
		b.field("fix", diagnostic.SuggestedFix)
		if diagnostic.Source != nil {
			b.field("source", formatIndexSourceLocation(b.projectRoot, *diagnostic.Source, b.pathWidth))
		}
	}
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
