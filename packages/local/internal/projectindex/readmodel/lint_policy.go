package readmodel

import (
	"os"
	"regexp"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

var indexLintSuppressionPattern = regexp.MustCompile(`crux-lint-disable-(next-line|line|file)\s+([@a-zA-Z0-9_./-]+)(?:\s+--\s*(.*))?`)

type indexLintSuppression struct {
	file   string
	line   int
	scope  string
	ruleID string
	used   bool
}

func applyIndexLintPolicy(index *store.IndexData) {
	if index == nil || len(index.LintFindings) == 0 {
		return
	}
	findings := applyIndexLintRuleConfig(index.LintFindings, index.Lint)
	findings, used := applyIndexLintSourceSuppressions(findings, indexLintSourceFiles(*index))
	index.Diagnostics = removeIndexLintUnusedSuppressionDiagnostics(index.Diagnostics, used)
	index.LintFindings = selectIndexLintProfile(findings, index.Lint)
}

func applyIndexLintRuleConfig(findings []store.IndexLintFinding, config *store.IndexLintConfig) []store.IndexLintFinding {
	if config == nil || len(config.Rules) == 0 {
		return findings
	}
	selected := make([]store.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		ruleConfig, ok := config.Rules[finding.RuleID]
		if ok && ruleConfig.Enabled != nil && !*ruleConfig.Enabled {
			continue
		}
		if ok && ruleConfig.Severity != "" {
			finding.Severity = ruleConfig.Severity
		}
		selected = append(selected, finding)
	}
	return selected
}

func selectIndexLintProfile(findings []store.IndexLintFinding, config *store.IndexLintConfig) []store.IndexLintFinding {
	profile := "recommended"
	if config != nil && config.Profile != "" {
		profile = config.Profile
	}
	if profile == "off" {
		return []store.IndexLintFinding{}
	}
	selected := make([]store.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		if !finding.Suppressed && containsString(finding.Profiles, profile) {
			selected = append(selected, finding)
		}
	}
	return selected
}

func applyIndexLintSourceSuppressions(findings []store.IndexLintFinding, files []string) ([]store.IndexLintFinding, []indexLintSuppression) {
	suppressions := parseIndexLintSuppressions(files)
	if len(suppressions) == 0 {
		return findings, nil
	}
	selected := make([]store.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		matched := false
		for i := range suppressions {
			if indexLintSuppressionMatches(suppressions[i], finding) {
				suppressions[i].used = true
				matched = true
				break
			}
		}
		if !matched {
			selected = append(selected, finding)
		}
	}
	used := make([]indexLintSuppression, 0)
	for _, suppression := range suppressions {
		if suppression.used {
			used = append(used, suppression)
		}
	}
	return selected, used
}

func indexLintSourceFiles(index store.IndexData) []string {
	files := make([]string, 0, len(index.Sources)+len(index.Definitions))
	seen := map[string]bool{}
	add := func(file string) {
		if file != "" && !seen[file] {
			seen[file] = true
			files = append(files, file)
		}
	}
	for _, source := range index.Sources {
		add(source.File)
	}
	for _, definition := range index.Definitions {
		if definition.Source != nil {
			add(definition.Source.File)
		}
		for _, ref := range definition.SourceRefs {
			add(ref.Source.File)
		}
	}
	return files
}

func parseIndexLintSuppressions(files []string) []indexLintSuppression {
	var suppressions []indexLintSuppression
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		for index, lineText := range strings.Split(string(raw), "\n") {
			match := indexLintSuppressionPattern.FindStringSubmatchIndex(lineText)
			if match == nil {
				continue
			}
			suppressions = append(suppressions, indexLintSuppression{
				file: file, line: index + 1,
				scope: lineText[match[2]:match[3]], ruleID: lineText[match[4]:match[5]],
			})
		}
	}
	return suppressions
}

func indexLintSuppressionMatches(suppression indexLintSuppression, finding store.IndexLintFinding) bool {
	if finding.RuleID != suppression.ruleID || finding.Source == nil || finding.Source.File != suppression.file {
		return false
	}
	switch suppression.scope {
	case "file":
		return true
	case "line":
		return finding.Source.Line == suppression.line
	default:
		return finding.Source.Line == suppression.line+1
	}
}

func removeIndexLintUnusedSuppressionDiagnostics(diagnostics []store.IndexDiagnostic, suppressions []indexLintSuppression) []store.IndexDiagnostic {
	if len(diagnostics) == 0 || len(suppressions) == 0 {
		return diagnostics
	}
	selected := make([]store.IndexDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		matched := false
		if diagnostic.Code == "index.lint_unused_suppression" && diagnostic.Source != nil {
			for _, suppression := range suppressions {
				if diagnostic.Source.File == suppression.file && diagnostic.Source.Line == suppression.line {
					matched = true
					break
				}
			}
		}
		if !matched {
			selected = append(selected, diagnostic)
		}
	}
	return selected
}
