package quality

import (
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func enrichQualityInsightsWithIndex(insights []qualityInsightRecord, index store.IndexData, dir string, runs []qualityRunRecord) ([]qualityInsightRecord, error) {
	if len(insights) == 0 || len(index.Definitions) == 0 {
		return insights, nil
	}

	definitionByID := map[string]store.ProjectDefinition{}
	for _, def := range index.Definitions {
		definitionByID[def.ID] = def
	}

	fs := qualityfs.Open(dir)
	snapshot, err := fs.Snapshot()
	if err != nil {
		return nil, err
	}
	specExperiments, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return nil, err
	}
	experimentToDefinitionIDs := map[string][]string{}
	traceToDefinitionIDs := map[string][]string{}
	for _, file := range specExperiments {
		record := file.Record
		// An evaluation links to its Project Index definition and, where the
		// evaluation id mirrors a primitive id, to that primitive too.
		candidates := append(
			qualityTargetDefinitionIDs(record.EvaluationID),
			"evaluation:"+safeQualityIndexID(record.EvaluationID),
		)
		defIDs := knownDefinitionIDs(definitionByID, candidates)
		experimentToDefinitionIDs[record.ExperimentID] = defIDs
		for _, cell := range record.Cells {
			for _, traceID := range cell.TraceIDs {
				if traceID == "" {
					continue
				}
				for _, defID := range defIDs {
					traceToDefinitionIDs[traceID] = appendQualityUniqueString(traceToDefinitionIDs[traceID], defID)
				}
			}
		}
	}

	cassetteToDefinitionIDs := map[string][]string{}
	for _, cassette := range snapshot.Cassettes {
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
