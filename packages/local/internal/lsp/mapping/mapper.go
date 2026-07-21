package mapping

import (
	"encoding/json"
	"net/url"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// DocsOrigin is the canonical origin for site-relative Project Index docs.
const DocsOrigin = "https://usecrux.dev"

// Options supplies scope identity and live definition lookup to a Mapper.
type Options struct {
	Root       string
	ConfigFile string
	Lines      *LineIndex
	Definition func(string) (api.ProjectDefinition, bool)
}

// Mapper converts findings for one configured workspace scope.
type Mapper struct {
	options Options
}

// New creates a scope-local diagnostic mapper.
func New(options Options) *Mapper {
	if options.Lines == nil {
		options.Lines = NewLineIndex()
	}
	return &Mapper{options: options}
}

// Map converts one finding and returns its publication URI and diagnostic.
func (m *Mapper) Map(finding api.IndexLintFinding) (protocol.DocumentURI, protocol.Diagnostic) {
	file, diagnosticRange := m.findingRange(finding)
	uri := protocol.DocumentURI(FileURI(m.options.Root, file))
	diagnostic := protocol.Diagnostic{
		Range:    diagnosticRange,
		Severity: diagnosticSeverity(finding),
		Code:     protocol.DiagnosticCode(finding.RuleID),
		Source:   "crux",
		Message:  diagnosticMessage(finding.Title, finding.Message),
		Data:     diagnosticData(finding),
	}
	if href := ResolveDocsURL(finding.DocsURL); href != "" {
		diagnostic.CodeDescription = &protocol.CodeDescription{Href: protocol.DocumentURI(href)}
	}
	if finding.Suppressed {
		diagnostic.Tags = []protocol.DiagnosticTag{protocol.DiagnosticTagUnnecessary}
	}
	diagnostic.RelatedInformation = m.relatedInformation(finding, uri, diagnosticRange)
	return uri, diagnostic
}

// MapFindings groups and deterministically sorts complete diagnostics by URI.
func (m *Mapper) MapFindings(findings []api.IndexLintFinding) map[protocol.DocumentURI][]protocol.Diagnostic {
	type mapped struct {
		id         string
		diagnostic protocol.Diagnostic
	}
	grouped := make(map[protocol.DocumentURI][]mapped)
	for _, finding := range findings {
		uri, diagnostic := m.Map(finding)
		grouped[uri] = append(grouped[uri], mapped{id: finding.ID, diagnostic: diagnostic})
	}
	result := make(map[protocol.DocumentURI][]protocol.Diagnostic, len(grouped))
	for uri, values := range grouped {
		sort.SliceStable(values, func(left, right int) bool {
			a, b := values[left], values[right]
			if a.diagnostic.Range.Start.Line != b.diagnostic.Range.Start.Line {
				return a.diagnostic.Range.Start.Line < b.diagnostic.Range.Start.Line
			}
			if a.diagnostic.Range.Start.Character != b.diagnostic.Range.Start.Character {
				return a.diagnostic.Range.Start.Character < b.diagnostic.Range.Start.Character
			}
			if a.diagnostic.Code != b.diagnostic.Code {
				return a.diagnostic.Code < b.diagnostic.Code
			}
			return a.id < b.id
		})
		diagnostics := make([]protocol.Diagnostic, len(values))
		for index := range values {
			diagnostics[index] = values[index].diagnostic
		}
		result[uri] = diagnostics
	}
	return result
}

// ResolveDocsURL makes site-relative docs links absolute and preserves valid
// absolute HTTP(S) links.
func ResolveDocsURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		return value
	}
	return strings.TrimRight(DocsOrigin, "/") + "/" + strings.TrimLeft(value, "/")
}

func diagnosticSeverity(finding api.IndexLintFinding) protocol.DiagnosticSeverity {
	if finding.Maturity == "experimental" {
		return protocol.SeverityHint
	}
	switch finding.Severity {
	case "error":
		return protocol.SeverityError
	case "warning":
		return protocol.SeverityWarning
	default:
		return protocol.SeverityInformation
	}
}

func diagnosticMessage(title, message string) string {
	if message == "" || message == title {
		return title
	}
	return title + ": " + message
}

func diagnosticData(finding api.IndexLintFinding) json.RawMessage {
	data, _ := json.Marshal(struct {
		ID          string                    `json:"id"`
		RuleID      string                    `json:"ruleId"`
		Category    string                    `json:"category"`
		Fixes       []api.IndexLintFix        `json:"fixes"`
		Suppression *api.IndexLintSuppression `json:"suppression"`
	}{finding.ID, finding.RuleID, finding.Category, finding.Fixes, finding.Suppression})
	return data
}

func (m *Mapper) findingRange(finding api.IndexLintFinding) (string, protocol.Range) {
	if finding.Source == nil {
		return m.options.ConfigFile, wholeLine(1)
	}
	if finding.PrimaryDefinitionID != "" && m.options.Definition != nil {
		if definition, ok := m.options.Definition(finding.PrimaryDefinitionID); ok && definition.SourceSnippet != nil {
			sourceRange := definition.SourceSnippet.Range
			if sameFile(m.options.Root, sourceRange.File, finding.Source.File) && rangeCoversLine(sourceRange, finding.Source.Line) {
				return finding.Source.File, m.sourceRange(sourceRange)
			}
		}
	}
	return finding.Source.File, m.sourceLocRange(*finding.Source)
}

func (m *Mapper) sourceLocRange(source api.SourceLoc) protocol.Range {
	if source.Column == nil {
		return wholeLine(source.Line)
	}
	character := m.options.Lines.UTF16Column(resolveFile(m.options.Root, source.File), source.Line, *source.Column)
	position := protocol.Position{Line: zeroLine(source.Line), Character: character}
	return protocol.Range{Start: position, End: position}
}

func wholeLine(line int) protocol.Range {
	start := zeroLine(line)
	return protocol.Range{Start: protocol.Position{Line: start}, End: protocol.Position{Line: start + 1}}
}

func zeroLine(line int) uint32 {
	if line <= 1 {
		return 0
	}
	return uint32(line - 1)
}
