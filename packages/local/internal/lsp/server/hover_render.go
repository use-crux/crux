package server

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const maxHoverFindings = 3

func buildHover(findings []displayedFinding, format protocol.MarkupKind) *protocol.Hover {
	return buildHoverWithDefinition(findings, nil, format)
}

func buildHoverWithDefinition(
	findings []displayedFinding,
	definition *definitionSummary,
	format protocol.MarkupKind,
) *protocol.Hover {
	return buildHoverWithPromptText(findings, definition, nil, format)
}

func buildHoverWithPromptText(
	findings []displayedFinding,
	definition *definitionSummary,
	promptText *lsprompttext.PromptTextHover,
	format protocol.MarkupKind,
) *protocol.Hover {
	ordered := append([]displayedFinding(nil), findings...)
	sort.SliceStable(ordered, func(left, right int) bool {
		return displayedFindingLess(ordered[left], ordered[right])
	})
	var hoverRange protocol.Range
	if len(ordered) > 0 {
		hoverRange = ordered[0].Diagnostic.Range
	} else if definition != nil {
		hoverRange = definition.Definition.Range
	} else if promptText != nil {
		hoverRange = promptText.Range
	}
	if len(ordered) > maxHoverFindings {
		ordered = ordered[:maxHoverFindings]
	}

	var writer cappedHoverWriter
	for findingIndex, displayed := range ordered {
		sections := findingHoverSections(displayed.Finding, format)
		for sectionIndex, section := range sections {
			separator := "\n\n"
			if findingIndex == 0 && sectionIndex == 0 {
				separator = ""
			} else if sectionIndex == 0 {
				separator = "\n\n---\n\n"
			}
			if !writer.append(section, separator) {
				break
			}
		}
		if writer.truncated {
			break
		}
	}
	if !writer.truncated && len(findings) > maxHoverFindings {
		remainder := len(findings) - maxHoverFindings
		footer := "…and " + strconv.Itoa(remainder) + " more Crux findings on this line"
		if format == protocol.MarkupKindMarkdown {
			footer = "*" + footer + "*"
		}
		writer.append(hoverSection{content: footer, atomic: true}, "\n\n")
	}
	if !writer.truncated && definition != nil {
		for index, section := range definitionHoverSections(*definition, format) {
			separator := "\n\n"
			if index == 0 {
				separator = ""
				if writer.units > 0 {
					separator = "\n\n---\n\n"
				}
			}
			if !writer.append(section, separator) {
				break
			}
		}
	}
	if !writer.truncated && promptText != nil {
		separator := ""
		if writer.units > 0 {
			if format == protocol.MarkupKindMarkdown {
				separator = "\n\n---\n\n"
			} else {
				separator = "\n\n"
			}
		}
		writer.append(promptTextHoverSection(*promptText, format), separator)
	}
	return &protocol.Hover{
		Contents: protocol.MarkupContent{Kind: format, Value: writer.String()},
		Range:    &hoverRange,
	}
}

func definitionHoverSections(
	summary definitionSummary,
	format protocol.MarkupKind,
) []hoverSection {
	markdown := format == protocol.MarkupKindMarkdown
	escape := normalizeEngineText
	if markdown {
		escape = escapeMarkdown
	}
	definition := summary.Definition.Definition
	name, kind := escape(definition.Name), escape(definition.Kind)
	sections := make([]hoverSection, 0, 3)
	if markdown && name != "" {
		suffix := "**"
		if kind != "" {
			suffix += " — " + kind
		}
		sections = append(sections, hoverSection{prefix: "**", content: name, suffix: suffix})
	} else if title := definitionTitle(name, kind); title != "" {
		sections = append(sections, hoverSection{content: title})
	}
	if description := escape(definition.Description); description != "" {
		sections = append(sections, hoverSection{content: description})
	}
	if details := knowledgeDefinitionDetails(definition, escape, markdown); details != "" {
		sections = append(sections, hoverSection{content: details})
	}
	sections = append(sections, hoverSection{content: definitionCountSummary(summary)})
	return sections
}

func knowledgeDefinitionDetails(
	definition api.ProjectDefinition,
	escape func(string) string,
	markdown bool,
) string {
	if !isKnowledgeDefinitionKind(definition.Kind) {
		return ""
	}
	facts := definitionFacts(definition.Metadata)
	parts := []string{"kind " + escape(definition.Kind), "id " + escape(definition.ID)}
	if version := metadataString(facts, "version"); version != "" {
		parts = append(parts, "version "+escape(version))
	}
	if types := metadataStringArray(facts, "typeNames"); len(types) > 0 {
		for index := range types {
			types[index] = escape(types[index])
		}
		parts = append(parts, "types "+strings.Join(types, ", "))
	}
	details := strings.Join(parts, " · ")
	if markdown {
		return "**Definition:** " + details
	}
	return "Definition: " + details
}

func isKnowledgeDefinitionKind(kind string) bool {
	switch kind {
	case "rag.knowledgeBase",
		"rag.knowledgeBase.view",
		"knowledge.relation",
		"knowledge.assertions",
		"knowledge.communities",
		"knowledge.model":
		return true
	default:
		return false
	}
}

func definitionFacts(metadata json.RawMessage) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(metadata, &decoded); err != nil {
		return nil
	}
	facts, _ := decoded["facts"].(map[string]any)
	return facts
}

func metadataString(metadata map[string]any, key string) string {
	switch value := metadata[key].(type) {
	case string:
		return value
	case float64:
		if value == float64(int64(value)) {
			return strconv.FormatInt(int64(value), 10)
		}
		return strconv.FormatFloat(value, 'f', -1, 64)
	default:
		return ""
	}
}

func metadataStringArray(metadata map[string]any, key string) []string {
	values, _ := metadata[key].([]any)
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if item, ok := value.(string); ok && item != "" {
			result = append(result, item)
		}
	}
	return result
}

func definitionTitle(name, kind string) string {
	if name == "" {
		return kind
	}
	if kind == "" {
		return name
	}
	return name + " — " + kind
}

func definitionCountSummary(summary definitionSummary) string {
	parts := make([]string, 0, 3)
	if summary.FindingCount > 0 {
		parts = append(parts, countLabel(summary.FindingCount, "finding", "findings"))
	}
	parts = append(parts,
		strconv.Itoa(summary.IncomingRelations)+" incoming",
		countLabel(summary.OutgoingRelations, "outgoing relation", "outgoing relations"),
	)
	return strings.Join(parts, " · ")
}

func countLabel(count int, singular, plural string) string {
	label := plural
	if count == 1 {
		label = singular
	}
	return strconv.Itoa(count) + " " + label
}

func displayedFindingLess(left, right displayedFinding) bool {
	if left.Diagnostic.Range.Start.Line != right.Diagnostic.Range.Start.Line {
		return left.Diagnostic.Range.Start.Line < right.Diagnostic.Range.Start.Line
	}
	if left.Diagnostic.Range.Start.Character != right.Diagnostic.Range.Start.Character {
		return left.Diagnostic.Range.Start.Character < right.Diagnostic.Range.Start.Character
	}
	if left.Diagnostic.Code != right.Diagnostic.Code {
		return left.Diagnostic.Code < right.Diagnostic.Code
	}
	return left.Finding.ID < right.Finding.ID
}

func findingHoverSections(finding api.IndexLintFinding, format protocol.MarkupKind) []hoverSection {
	markdown := format == protocol.MarkupKindMarkdown
	escape := normalizeEngineText
	if markdown {
		escape = escapeMarkdown
	}
	sections := make([]hoverSection, 0, 7)
	if title := escape(finding.Title); title != "" || finding.RuleID != "" {
		sections = append(sections, titleSection(title, normalizeEngineText(finding.RuleID), markdown))
	}
	if severity := severitySummary(finding, escape); severity != "" {
		sections = append(sections, hoverSection{content: severity})
	}
	if finding.Message != "" && finding.Message != finding.Title {
		sections = append(sections, hoverSection{content: escape(finding.Message)})
	}
	if rationale := escape(finding.Rationale); rationale != "" {
		sections = append(sections, hoverSection{content: rationale})
	}
	if impact := escape(finding.Impact); impact != "" {
		prefix := "Impact: "
		if markdown {
			prefix = "**Impact:** "
		}
		sections = append(sections, hoverSection{prefix: prefix, content: impact})
	}
	if finding.Suppressed {
		sections = append(sections, suppressionSection(finding.SuppressedBy, escape, markdown))
	}
	if docsURL := mapping.ResolveDocsURL(finding.DocsURL); docsURL != "" {
		content := "Rule documentation: " + docsURL
		if markdown {
			content = "[Rule documentation](" + docsURL + ")"
		}
		sections = append(sections, hoverSection{content: content, atomic: true})
	}
	return sections
}

func titleSection(title, ruleID string, markdown bool) hoverSection {
	if !markdown {
		if title == "" {
			return hoverSection{content: ruleID}
		}
		if ruleID == "" {
			return hoverSection{content: title}
		}
		return hoverSection{content: title + " — " + ruleID}
	}
	if title == "" {
		return hoverSection{prefix: "`", content: ruleID, suffix: "`"}
	}
	suffix := "**"
	if ruleID != "" {
		suffix += " — `" + ruleID + "`"
	}
	return hoverSection{prefix: "**", content: title, suffix: suffix}
}

func severitySummary(finding api.IndexLintFinding, escape func(string) string) string {
	severity := strings.ToLower(normalizeEngineText(finding.Severity))
	icon := "ℹ"
	switch severity {
	case "error":
		icon = "✖"
	case "warning":
		icon = "⚠"
	case "":
		severity = "info"
	}
	parts := []string{icon + " " + escape(severity)}
	if maturity := escape(finding.Maturity); maturity != "" {
		parts = append(parts, maturity)
	}
	if confidence := escape(finding.Confidence); confidence != "" {
		parts = append(parts, "confidence "+confidence)
	}
	if finding.Maturity == "experimental" {
		parts = append(parts, "shown as hint")
	}
	return strings.Join(parts, " · ")
}

func suppressionSection(
	suppressedBy *api.IndexLintSuppressedBy,
	escape func(string) string,
	markdown bool,
) hoverSection {
	prefix := "Suppressed: "
	if markdown {
		prefix = "*Suppressed:* "
	}
	if suppressedBy == nil {
		return hoverSection{content: strings.TrimSpace(prefix)}
	}
	content := escape(suppressedBy.Reason)
	if suppressedBy.Source != nil {
		location := escape(suppressedBy.Source.File) + ":" + strconv.Itoa(suppressedBy.Source.Line)
		if content != "" {
			content += " "
		}
		content += "(" + location + ")"
	}
	if content == "" {
		return hoverSection{content: strings.TrimSpace(prefix)}
	}
	return hoverSection{prefix: prefix, content: content}
}
