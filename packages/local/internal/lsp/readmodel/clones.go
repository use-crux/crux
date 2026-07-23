package readmodel

import "github.com/use-crux/crux/packages/local/internal/api"

func cloneFindings(findings []api.IndexLintFinding) []api.IndexLintFinding {
	if findings == nil {
		return nil
	}
	result := make([]api.IndexLintFinding, len(findings))
	for index := range findings {
		result[index] = findings[index]
		result[index].Profiles = append([]string(nil), findings[index].Profiles...)
		result[index].RelatedDefinitionIDs = append([]string(nil), findings[index].RelatedDefinitionIDs...)
		result[index].AffectedDefinitionIDs = append([]string(nil), findings[index].AffectedDefinitionIDs...)
		result[index].PropagatedDefinitionIDs = append([]string(nil), findings[index].PropagatedDefinitionIDs...)
		result[index].Evidence = append([]api.IndexLintEvidence(nil), findings[index].Evidence...)
		result[index].Fixes = append([]api.IndexLintFix(nil), findings[index].Fixes...)
		result[index].PropagationPaths = append([]api.IndexLintPropagationPath(nil), findings[index].PropagationPaths...)
		result[index].Source = cloneSource(findings[index].Source)
		for evidenceIndex := range result[index].Evidence {
			result[index].Evidence[evidenceIndex].Source = cloneSource(findings[index].Evidence[evidenceIndex].Source)
			result[index].Evidence[evidenceIndex].Data = append([]byte(nil), findings[index].Evidence[evidenceIndex].Data...)
		}
		for pathIndex := range result[index].PropagationPaths {
			result[index].PropagationPaths[pathIndex].RelationTypes = append(
				[]string(nil),
				findings[index].PropagationPaths[pathIndex].RelationTypes...,
			)
		}
		if findings[index].Suppression != nil {
			suppression := *findings[index].Suppression
			result[index].Suppression = &suppression
		}
		if findings[index].SuppressedBy != nil {
			suppressedBy := *findings[index].SuppressedBy
			suppressedBy.Source = cloneSource(findings[index].SuppressedBy.Source)
			result[index].SuppressedBy = &suppressedBy
		}
	}
	return result
}

func cloneSource(source *api.SourceLoc) *api.SourceLoc {
	if source == nil {
		return nil
	}
	result := *source
	if source.Column != nil {
		column := *source.Column
		result.Column = &column
	}
	return &result
}
