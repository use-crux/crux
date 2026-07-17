package inspect

import "github.com/use-crux/crux/packages/local/internal/store"

func enrichInspectInsightsWithIndex(insights []inspectInsightRecord, index store.IndexData, dir string, runs []inspectRunRecord) ([]inspectInsightRecord, error) {
	if len(insights) == 0 || len(index.Definitions) == 0 {
		return insights, nil
	}

	definitionByID := map[string]store.ProjectDefinition{}
	for _, def := range index.Definitions {
		definitionByID[def.ID] = def
	}

	traceToDefinitionIDs := map[string][]string{}

	for _, run := range runs {
		for _, defID := range knownDefinitionIDs(definitionByID, inspectTargetDefinitionIDs(run.TargetID)) {
			traceToDefinitionIDs[run.TraceID] = appendInspectUniqueString(traceToDefinitionIDs[run.TraceID], defID)
		}
	}

	for i := range insights {
		defIDs := knownDefinitionIDs(definitionByID, inspectTargetDefinitionIDs(insights[i].TargetID))
		for _, traceID := range insights[i].LinkedTraceIDs {
			defIDs = appendInspectUniqueStrings(defIDs, traceToDefinitionIDs[traceID]...)
		}
		insights[i].LinkedDefinitionIDs = appendInspectUniqueStrings(insights[i].LinkedDefinitionIDs, defIDs...)
		for _, defID := range defIDs {
			def := definitionByID[defID]
			if def.Source != nil {
				insights[i].LinkedSources = appendUniqueSourceLoc(insights[i].LinkedSources, *def.Source)
			}
		}
	}

	return insights, nil
}

func knownDefinitionIDs(definitionByID map[string]store.ProjectDefinition, candidates []string) []string {
	out := []string{}
	for _, candidate := range candidates {
		if _, ok := definitionByID[candidate]; ok {
			out = appendInspectUniqueString(out, candidate)
		}
	}
	return out
}

func appendInspectUniqueStrings(values []string, next ...string) []string {
	for _, value := range next {
		values = appendInspectUniqueString(values, value)
	}
	return values
}

func appendUniqueSourceLoc(values []store.SourceLoc, next store.SourceLoc) []store.SourceLoc {
	for _, value := range values {
		if value.File == next.File && value.Line == next.Line && value.Column == next.Column {
			return values
		}
	}
	return append(values, next)
}
