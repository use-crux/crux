package screens

import "github.com/use-crux/crux/packages/local/internal/api"

func (s *Index) lintFindingsForDefinition(definitionID string) []api.IndexLintFinding {
	index := s.indexData()
	if definitionID == "" || len(index.LintFindings) == 0 {
		return nil
	}
	findings := make([]api.IndexLintFinding, 0)
	for _, finding := range index.LintFindings {
		if indexLintFindingReferencesDefinition(finding, definitionID) {
			findings = append(findings, finding)
		}
	}
	return findings
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
