package readmodel

import "github.com/use-crux/crux/packages/local/internal/api"

func catalogRoot(index api.IndexData) string {
	if index.Project == nil {
		return ""
	}
	return index.Project.Root
}

func safeCatalogDefinition(root string, definition api.ProjectDefinition) api.ProjectDefinition {
	definition.Source = safeCatalogSource(root, definition.Source)
	definition.SourceSnippet = safeCatalogSnippet(root, definition.SourceSnippet)
	definition.Metadata = nil
	refs := make([]api.ProjectSourceRef, 0, len(definition.SourceRefs))
	for _, ref := range definition.SourceRefs {
		source := safeCatalogSource(root, &ref.Source)
		if source == nil {
			continue
		}
		ref.Source = *source
		ref.Snippet = safeCatalogSnippet(root, ref.Snippet)
		ref.Metadata = nil
		refs = append(refs, ref)
	}
	definition.SourceRefs = refs
	return definition
}

func safeCatalogSnippet(root string, snippet *api.SourceSnippet) *api.SourceSnippet {
	if snippet == nil {
		return nil
	}
	file := safeCatalogPath(root, snippet.Range.File)
	if file == "" {
		return nil
	}
	copy := *snippet
	copy.Range.File = file
	return &copy
}

func safeCatalogLint(root string, finding api.IndexLintFinding) api.IndexLintFinding {
	finding.Source = safeCatalogSource(root, finding.Source)
	evidence := make([]api.IndexLintEvidence, len(finding.Evidence))
	copy(evidence, finding.Evidence)
	for index := range evidence {
		evidence[index].Source = safeCatalogSource(root, evidence[index].Source)
		evidence[index].Data = nil
	}
	finding.Evidence = evidence
	if finding.SuppressedBy != nil {
		copy := *finding.SuppressedBy
		copy.Source = safeCatalogSource(root, copy.Source)
		finding.SuppressedBy = &copy
	}
	return finding
}
