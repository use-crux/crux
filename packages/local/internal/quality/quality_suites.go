package quality

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func buildQualitySuites(dir string, index store.IndexData) ([]qualitySuiteRecord, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		return nil, err
	}
	experiments := snapshot.Experiments
	feedback := snapshot.Feedback
	suitesByID := map[string]qualitySuiteRecord{}
	sortKeys := map[string]string{}
	for _, suite := range qualitySuitesFromIndex(index) {
		suitesByID[suite.SuiteID] = suite
	}
	for _, experiment := range experiments {
		suiteID := experiment.Suite.ID
		if suiteID == "" {
			suiteID = "default"
		}
		sortKey := qualityExperimentSortKey(experiment)
		current, exists := suitesByID[suiteID]
		if !exists || sortKey >= sortKeys[suiteID] {
			passRate := passRateFromSummary(experiment.Summary.Passed, experiment.Summary.Total)
			current = qualitySuiteRecord{
				Tag:              "QualitySuite",
				SuiteID:          suiteID,
				Name:             experiment.Suite.Name,
				Version:          qualitySuiteVersion(experiment.Suite.Source),
				Source:           qualitySuiteSource(experiment.Suite.Source),
				Path:             experiment.Suite.Path,
				CaseCount:        experiment.Suite.CaseCount,
				Tags:             experiment.Suite.Tags,
				Scorers:          qualityScorersFromCases(experiment.Cases),
				LastExperimentID: experiment.ID,
				LastRunAt:        nonEmptyString(experiment.EndedAt, experiment.StartedAt),
				LastPassRate:     &passRate,
				Cases:            qualitySuiteCasesFromExperiment(experiment, feedback),
			}
			if current.CaseCount == 0 {
				current.CaseCount = len(current.Cases)
			}
			current = enrichQualitySuiteCases(normalizeSuiteRecord(current), experiments, feedback)
			suitesByID[suiteID] = current
			sortKeys[suiteID] = sortKey
		}
	}
	persistedSuites, err := qualitySuiteRecords(dir)
	if err != nil {
		return nil, err
	}
	for _, persisted := range persistedSuites {
		persisted = normalizeSuiteRecord(persisted)
		if derived, exists := suitesByID[persisted.SuiteID]; exists {
			if persisted.LastExperimentID == "" {
				persisted.LastExperimentID = derived.LastExperimentID
			}
			if persisted.LastPassRate == nil {
				persisted.LastPassRate = derived.LastPassRate
			}
		}
		suitesByID[persisted.SuiteID] = persisted
	}
	suites := make([]qualitySuiteRecord, 0, len(suitesByID))
	for _, suite := range suitesByID {
		suites = append(suites, enrichQualitySuiteCases(suite, experiments, feedback))
	}
	sort.SliceStable(suites, func(i, j int) bool {
		return suites[i].SuiteID < suites[j].SuiteID
	})
	return suites, nil
}

func buildQualitySuiteDetail(dir string, index store.IndexData, suiteID string) (qualitySuiteRecord, bool, error) {
	suites, err := buildQualitySuites(dir, index)
	if err != nil {
		return qualitySuiteRecord{}, false, err
	}
	for _, suite := range suites {
		if suite.SuiteID == suiteID {
			return suite, true, nil
		}
	}
	return qualitySuiteRecord{}, false, nil
}

func qualitySuitesFromIndex(index store.IndexData) []qualitySuiteRecord {
	suites := []qualitySuiteRecord{}
	casesBySuiteID := indexSuiteCasesBySuiteID(index)
	for _, definition := range index.Definitions {
		if definition.Kind != "suite" || definition.ID == "" {
			continue
		}
		record := qualitySuiteFromIndexDefinition(definition)
		if record.SuiteID == "" {
			continue
		}
		record.Cases = casesBySuiteID[record.SuiteID]
		record = normalizeSuiteRecord(record)
		suites = append(suites, record)
	}
	return suites
}

func qualitySuiteFromIndexDefinition(definition store.ProjectDefinition) qualitySuiteRecord {
	metadata := indexSuiteMetadata(definition.Metadata)
	suiteID := strings.TrimPrefix(definition.ID, "suite:")
	source := nonEmptyString(metadata.Source, "code")
	path := metadata.Path
	if path == "" && definition.Source != nil {
		path = definition.Source.File
	}
	return normalizeSuiteRecord(qualitySuiteRecord{
		SuiteID:   suiteID,
		Name:      nonEmptyString(definition.Name, suiteID),
		Source:    source,
		Path:      path,
		CaseCount: metadata.CaseCount,
		Tags:      append([]string(nil), definition.Tags...),
		State:     "discovered",
		Cases:     []qualitySuiteCase{},
	})
}

type indexSuiteMetadataRecord struct {
	Source    string `json:"source"`
	Path      string `json:"path"`
	CaseCount int    `json:"caseCount"`
}

type indexSuiteCaseMetadataRecord struct {
	SuiteID  string          `json:"suiteId"`
	CaseID   string          `json:"caseId"`
	Input    json.RawMessage `json:"input"`
	Expected json.RawMessage `json:"expected"`
	Tags     []string        `json:"tags"`
	Metadata json.RawMessage `json:"metadata"`
}

func indexSuiteMetadata(raw json.RawMessage) indexSuiteMetadataRecord {
	if len(raw) == 0 {
		return indexSuiteMetadataRecord{}
	}
	var metadata indexSuiteMetadataRecord
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return indexSuiteMetadataRecord{}
	}
	return metadata
}

func indexSuiteCasesBySuiteID(index store.IndexData) map[string][]qualitySuiteCase {
	caseDefinitions := map[string]store.ProjectDefinition{}
	for _, definition := range index.Definitions {
		if definition.Kind == "suite.case" && definition.ID != "" {
			caseDefinitions[definition.ID] = definition
		}
	}
	casesBySuiteID := map[string][]qualitySuiteCase{}
	for _, relation := range index.Relations {
		if relation.Type != "suite.includes_case" || !strings.HasPrefix(relation.From, "suite:") {
			continue
		}
		definition, exists := caseDefinitions[relation.To]
		if !exists {
			continue
		}
		suiteID := strings.TrimPrefix(relation.From, "suite:")
		testCase := qualitySuiteCaseFromIndexDefinition(suiteID, definition)
		if testCase.CaseID == "" {
			continue
		}
		casesBySuiteID[suiteID] = append(casesBySuiteID[suiteID], testCase)
	}
	for suiteID, cases := range casesBySuiteID {
		sort.SliceStable(cases, func(i, j int) bool {
			return cases[i].CaseID < cases[j].CaseID
		})
		casesBySuiteID[suiteID] = cases
	}
	return casesBySuiteID
}

func qualitySuiteCaseFromIndexDefinition(suiteID string, definition store.ProjectDefinition) qualitySuiteCase {
	metadata := indexSuiteCaseMetadata(definition.Metadata)
	caseID := nonEmptyString(metadata.CaseID, strings.TrimPrefix(definition.ID, "suite.case:"+suiteID+":"))
	return normalizeSuiteCase(qualitySuiteCase{
		CaseID:   caseID,
		Name:     nonEmptyString(definition.Name, caseID),
		Input:    decodeIndexJSONValue(metadata.Input),
		Expected: decodeIndexJSONValue(metadata.Expected),
		Tags:     append([]string(nil), metadata.Tags...),
		Metadata: decodeIndexJSONRecord(metadata.Metadata),
	})
}

func indexSuiteCaseMetadata(raw json.RawMessage) indexSuiteCaseMetadataRecord {
	if len(raw) == 0 {
		return indexSuiteCaseMetadataRecord{}
	}
	var metadata indexSuiteCaseMetadataRecord
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return indexSuiteCaseMetadataRecord{}
	}
	return metadata
}

func decodeIndexJSONValue(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func decodeIndexJSONRecord(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func qualitySuiteRecords(dir string) ([]qualitySuiteRecord, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	return snapshot.Suites, err
}

func persistQualitySuite(dir string, record qualitySuiteRecord) (qualitySuiteRecord, error) {
	return qualityfs.Put(qualityfs.Open(dir), record)
}

func persistQualitySuiteCase(dir string, suiteID string, testCase qualitySuiteCase) (qualitySuiteRecord, error) {
	if suiteID == "" {
		return qualitySuiteRecord{}, fmt.Errorf("suiteId is required")
	}
	testCase = normalizeSuiteCase(testCase)
	if testCase.CaseID == "" {
		return qualitySuiteRecord{}, fmt.Errorf("caseId is required")
	}
	record, err := qualitySuiteRecordByID(dir, suiteID)
	if err != nil {
		record = qualitySuiteRecord{Tag: "QualitySuite", SuiteID: suiteID, Source: "json"}
	}
	replaced := false
	for index, existing := range record.Cases {
		if normalizeSuiteCase(existing).CaseID == testCase.CaseID {
			record.Cases[index] = testCase
			replaced = true
			break
		}
	}
	if !replaced {
		record.Cases = append(record.Cases, testCase)
	}
	return persistQualitySuite(dir, record)
}

func qualitySuiteRecordByID(dir string, suiteID string) (qualitySuiteRecord, error) {
	raw, found, err := qualityfs.Open(dir).ReadRaw(qualityfs.KindSuites, suiteID)
	if err != nil {
		return qualitySuiteRecord{}, err
	}
	if !found {
		return qualitySuiteRecord{}, fmt.Errorf("quality suite %q not found", suiteID)
	}
	var record qualitySuiteRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return qualitySuiteRecord{}, err
	}
	return normalizeSuiteRecord(record), nil
}

func normalizeSuiteRecord(record qualitySuiteRecord) qualitySuiteRecord {
	return qualityfs.NormalizeSuite(record)
}

func normalizeSuiteCase(testCase qualitySuiteCase) qualitySuiteCase {
	return qualityfs.NormalizeSuiteCase(testCase)
}

func qualitySuiteCasesFromExperiment(experiment qualityExperimentRecord, feedback []qualityFeedbackRecord) []qualitySuiteCase {
	if len(experiment.Suite.Snapshot) > 0 {
		record := qualitySuiteRecord{Cases: experiment.Suite.Snapshot}
		return enrichQualitySuiteCases(record, []qualityExperimentRecord{experiment}, feedback).Cases
	}
	casesByID := map[string]qualitySuiteCase{}
	for _, testCase := range experiment.Cases {
		caseID := testCase.CaseID
		if caseID == "" {
			caseID = testCase.CaseName
		}
		if caseID == "" {
			continue
		}
		status := "fail"
		if testCase.Status == "passed" || testCase.Status == "success" {
			status = "pass"
		}
		casesByID[caseID] = qualitySuiteCase{
			CaseID:              caseID,
			Name:                testCase.CaseName,
			Input:               testCase.Input,
			LastRunStatus:       status,
			LastRunExperimentID: experiment.ID,
			LastRunAt:           nonEmptyString(experiment.EndedAt, experiment.StartedAt),
		}
	}
	cases := make([]qualitySuiteCase, 0, len(casesByID))
	for _, testCase := range casesByID {
		cases = append(cases, testCase)
	}
	return cases
}

func enrichQualitySuiteCases(suite qualitySuiteRecord, experiments []qualityExperimentRecord, feedback []qualityFeedbackRecord) qualitySuiteRecord {
	for index, testCase := range suite.Cases {
		for _, experiment := range experiments {
			for _, result := range experiment.Cases {
				if result.CaseID != testCase.CaseID {
					continue
				}
				status := "fail"
				if result.Status == "passed" || result.Status == "success" {
					status = "pass"
				}
				at := nonEmptyString(experiment.EndedAt, experiment.StartedAt)
				if at >= testCase.LastRunAt {
					testCase.LastRunStatus = status
					testCase.LastRunExperimentID = experiment.ID
					testCase.LastRunAt = at
				}
			}
		}
		for _, item := range feedback {
			if item.CaseID == nil || *item.CaseID != testCase.CaseID || item.Rating == nil {
				continue
			}
			if *item.Rating > 0 {
				testCase.FeedbackRating = "up"
			} else if *item.Rating < 0 {
				testCase.FeedbackRating = "down"
			}
		}
		suite.Cases[index] = testCase
	}
	return suite
}

func qualitySuiteSource(source any) string {
	switch value := source.(type) {
	case string:
		return value
	case map[string]any:
		if kind, ok := value["kind"].(string); ok {
			return kind
		}
		if typ, ok := value["type"].(string); ok {
			return typ
		}
		return "composed"
	case nil:
		return ""
	default:
		return "composed"
	}
}

func qualitySuiteVersion(source any) string {
	switch value := source.(type) {
	case map[string]any:
		for _, key := range []string{"version", "snapshotId"} {
			if text, ok := value[key].(string); ok {
				return text
			}
		}
	}
	return ""
}

func qualityScorersFromCases(cases []qualityExperimentCase) []string {
	scorers := []string{}
	for _, testCase := range cases {
		for _, score := range testCase.Scores {
			scorers = appendUniqueString(scorers, score.Name)
		}
	}
	return scorers
}
