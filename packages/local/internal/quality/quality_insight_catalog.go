package quality

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func enrichQualityInsightsWithCatalog(insights []qualityInsightRecord, catalog store.CatalogData, dir string, runs []qualityRunRecord) ([]qualityInsightRecord, error) {
	if len(insights) == 0 || len(catalog.Definitions) == 0 {
		return insights, nil
	}

	definitionByID := map[string]store.ProjectDefinition{}
	for _, def := range catalog.Definitions {
		definitionByID[def.ID] = def
	}

	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
	experimentToDefinitionIDs := map[string][]string{}
	traceToDefinitionIDs := map[string][]string{}
	for _, experiment := range experiments {
		defIDs := knownDefinitionIDs(definitionByID, experimentDefinitionIDs(experiment))
		experimentToDefinitionIDs[experiment.ID] = defIDs
		for _, testCase := range experiment.Cases {
			if testCase.TraceID == "" {
				continue
			}
			for _, defID := range defIDs {
				traceToDefinitionIDs[testCase.TraceID] = appendQualityUniqueString(traceToDefinitionIDs[testCase.TraceID], defID)
			}
		}
	}

	cassettes, err := readQualityCassettes(filepath.Join(dir, "cassettes"))
	if err != nil {
		return nil, err
	}
	cassetteToDefinitionIDs := map[string][]string{}
	for _, cassette := range cassettes {
		for _, entry := range cassette.Entries {
			for _, defID := range knownDefinitionIDs(definitionByID, qualityTargetDefinitionIDs(entry.TargetID)) {
				cassetteToDefinitionIDs[cassette.Path] = appendQualityUniqueString(cassetteToDefinitionIDs[cassette.Path], defID)
			}
		}
	}

	for _, run := range runs {
		for _, defID := range knownDefinitionIDs(definitionByID, qualityTargetDefinitionIDs(run.TargetID)) {
			traceToDefinitionIDs[run.TraceID] = appendQualityUniqueString(traceToDefinitionIDs[run.TraceID], defID)
		}
	}

	for i := range insights {
		defIDs := knownDefinitionIDs(definitionByID, qualityTargetDefinitionIDs(insights[i].TargetID))
		for _, experimentID := range insights[i].LinkedExperimentIDs {
			defIDs = appendQualityUniqueStrings(defIDs, experimentToDefinitionIDs[experimentID]...)
		}
		for _, traceID := range insights[i].LinkedTraceIDs {
			defIDs = appendQualityUniqueStrings(defIDs, traceToDefinitionIDs[traceID]...)
		}
		for _, cassettePath := range insights[i].LinkedCassettePaths {
			defIDs = appendQualityUniqueStrings(defIDs, cassetteToDefinitionIDs[cassettePath]...)
		}
		insights[i].LinkedDefinitionIDs = appendQualityUniqueStrings(insights[i].LinkedDefinitionIDs, defIDs...)
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
			out = appendQualityUniqueString(out, candidate)
		}
	}
	return out
}

func appendQualityUniqueStrings(values []string, next ...string) []string {
	for _, value := range next {
		values = appendQualityUniqueString(values, value)
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
