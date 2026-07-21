package server

import (
	"sort"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const maxHoverFindings = 3

func buildHover(findings []displayedFinding, format protocol.MarkupKind) *protocol.Hover {
	ordered := append([]displayedFinding(nil), findings...)
	sort.SliceStable(ordered, func(left, right int) bool {
		return displayedFindingLess(ordered[left], ordered[right])
	})
	diagnosticRange := ordered[0].Diagnostic.Range
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
	return &protocol.Hover{
		Contents: protocol.MarkupContent{Kind: format, Value: writer.String()},
		Range:    &diagnosticRange,
	}
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
