package screens

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (s *Index) lintFindingsForDefinition(definitionID string) []api.IndexLintFinding {
	return activeLintFindingsForDefinition(s.indexData(), definitionID)
}

func activeLintFindingsForDefinition(index api.IndexData, definitionID string) []api.IndexLintFinding {
	return lintFindingsForDefinition(index, definitionID, false)
}

func lintFindingsForDefinition(index api.IndexData, definitionID string, includeSuppressed bool) []api.IndexLintFinding {
	if definitionID == "" || len(index.LintFindings) == 0 {
		return nil
	}
	findings := make([]api.IndexLintFinding, 0)
	for _, finding := range index.LintFindings {
		if finding.Suppressed && !includeSuppressed {
			continue
		}
		if indexLintFindingReferencesDefinition(finding, definitionID) {
			findings = append(findings, finding)
		}
	}
	return findings
}

func (s *Index) hasSuppressedFindings() bool {
	for _, finding := range s.indexData().LintFindings {
		if finding.Suppressed && indexLintFindingReferencesDefinition(finding, s.SelectedDefinitionID()) {
			return true
		}
	}
	return false
}

func (s *Index) suppressedActionLabel() string {
	if s.showSuppressed {
		return "hide suppressed lint"
	}
	return "show suppressed lint"
}

func (b *indexDocumentBuilder) renderLint(showSuppressed bool) {
	all := lintFindingsForDefinition(b.index, b.definition.ID, true)
	if len(all) == 0 {
		return
	}
	active, suppressed := 0, 0
	for _, finding := range all {
		if finding.Suppressed {
			suppressed++
		} else {
			active++
		}
	}
	b.document.lintAnchor = kit.DocumentAnchor{SourceLine: len(b.lines)}
	b.document.hasLint = true
	title := fmt.Sprintf("LINT · %d active", active)
	if suppressed > 0 {
		title += fmt.Sprintf(" · %d suppressed", suppressed)
	}
	b.section(title)
	for _, finding := range all {
		if finding.Suppressed && !showSuppressed {
			continue
		}
		b.renderLintFinding(finding)
	}
}

func (b *indexDocumentBuilder) renderLintFinding(finding api.IndexLintFinding) {
	state := strings.TrimSpace(finding.Severity + " · " + finding.RuleID)
	if finding.Suppressed {
		state += " · suppressed"
	}
	b.field("finding", state)
	b.field("title", finding.Title)
	b.field("message", finding.Message)
	b.field("why", finding.Rationale)
	b.field("impact", finding.Impact)
	b.field("health", joinNonEmpty(" · ", finding.Category, finding.Maturity, finding.Confidence))
	b.field("profiles", strings.Join(finding.Profiles, ", "))
	if finding.Source != nil {
		b.field("source", formatIndexSourceLocation(b.projectRoot, *finding.Source, b.pathWidth))
	}
	for index, evidence := range finding.Evidence {
		label := fmt.Sprintf("evidence %d", index+1)
		b.field(label, lintEvidenceText(b.projectRoot, evidence, b.pathWidth))
	}
	for index, fix := range finding.Fixes {
		label := fmt.Sprintf("fix %d", index+1)
		b.field(label, lintFixText(fix))
	}
	for index, path := range finding.PropagationPaths {
		label := fmt.Sprintf("path %d", index+1)
		route := path.FromDefinitionID + " → " + path.ToDefinitionID
		if len(path.RelationTypes) > 0 {
			route += " · " + strings.Join(path.RelationTypes, " → ")
		}
		b.field(label, route)
	}
	if finding.SuppressedBy != nil {
		b.field("suppressed by", lintSuppressedByText(b.projectRoot, *finding.SuppressedBy, b.pathWidth))
	}
	b.field("docs", finding.DocsURL)
}

func lintEvidenceText(projectRoot string, evidence api.IndexLintEvidence, pathWidth int) string {
	parts := []string{evidence.Kind, evidence.Label, evidence.Description}
	if evidence.DefinitionID != "" {
		parts = append(parts, "definition "+evidence.DefinitionID)
	}
	if evidence.RelationID != "" {
		parts = append(parts, "relation "+evidence.RelationID)
	}
	if evidence.Source != nil {
		parts = append(parts, formatIndexSourceLocation(projectRoot, *evidence.Source, pathWidth))
	}
	if data := compactIndexJSON(evidence.Data); data != "" {
		parts = append(parts, data)
	}
	return joinNonEmpty(" · ", parts...)
}

func lintFixText(fix api.IndexLintFix) string {
	return joinNonEmpty(" · ", fix.Kind, fix.Title, fix.Description, fix.Command, fix.Suppression, fix.DocsURL)
}

func lintSuppressedByText(projectRoot string, suppressed api.IndexLintSuppressedBy, pathWidth int) string {
	parts := []string{suppressed.Scope, suppressed.Reason}
	if suppressed.Source != nil {
		parts = append(parts, formatIndexSourceLocation(projectRoot, *suppressed.Source, pathWidth))
	}
	return joinNonEmpty(" · ", parts...)
}

func compactIndexJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return ""
	}
	return sanitizeIndexInline(compact.String())
}

func joinNonEmpty(separator string, values ...string) string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			filtered = append(filtered, value)
		}
	}
	return strings.Join(filtered, separator)
}

func indexLintFindingReferencesDefinition(finding api.IndexLintFinding, definitionID string) bool {
	if finding.PrimaryDefinitionID == definitionID {
		return true
	}
	return stringSliceContains(finding.RelatedDefinitionIDs, definitionID) ||
		stringSliceContains(finding.AffectedDefinitionIDs, definitionID) ||
		stringSliceContains(finding.PropagatedDefinitionIDs, definitionID)
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
