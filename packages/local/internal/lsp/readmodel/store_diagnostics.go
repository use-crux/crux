package readmodel

import "github.com/use-crux/crux/packages/local/internal/api"

func diagnosticsBySource(diagnostics []api.IndexDiagnostic) map[string][]api.IndexDiagnostic {
	result := make(map[string][]api.IndexDiagnostic)
	for _, diagnostic := range cloneIndexDiagnostics(diagnostics) {
		file := ""
		if diagnostic.Source != nil {
			file = diagnostic.Source.File
		}
		result[file] = append(result[file], diagnostic)
	}
	return result
}

func cloneIndexDiagnostics(diagnostics []api.IndexDiagnostic) []api.IndexDiagnostic {
	if diagnostics == nil {
		return nil
	}
	result := make([]api.IndexDiagnostic, len(diagnostics))
	for index, diagnostic := range diagnostics {
		result[index] = diagnostic
		result[index].Source = cloneSource(diagnostic.Source)
		result[index].RelatedDefinitionIDs = append([]string(nil), diagnostic.RelatedDefinitionIDs...)
	}
	return result
}
