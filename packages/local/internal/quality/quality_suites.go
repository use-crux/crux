package quality

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func buildQualitySuites(dir string) ([]qualitySuiteRecord, error) {
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
	feedback, err := readQualityFeedbackRecords(dir)
	if err != nil {
		return nil, err
	}
	suitesByID := map[string]qualitySuiteRecord{}
	sortKeys := map[string]string{}
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
			current = enrichQualitySuiteCases(normalizeQualitySuiteRecord(current), experiments, feedback)
			suitesByID[suiteID] = current
			sortKeys[suiteID] = sortKey
		}
	}
	persistedSuites, err := readQualitySuiteRecords(dir)
	if err != nil {
		return nil, err
	}
	for _, persisted := range persistedSuites {
		persisted = normalizeQualitySuiteRecord(persisted)
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
	return suites, nil
}

func buildQualitySuiteDetail(dir string, suiteID string) (qualitySuiteRecord, bool, error) {
	suites, err := buildQualitySuites(dir)
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

func readQualitySuiteRecords(dir string) ([]qualitySuiteRecord, error) {
	raw, err := readQualityRecords(dir, "suites")
	if err != nil {
		return nil, err
	}
	suites := make([]qualitySuiteRecord, 0, len(raw))
	for _, item := range raw {
		var record qualitySuiteRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		suites = append(suites, normalizeQualitySuiteRecord(record))
	}
	return suites, nil
}

func saveQualitySuite(dir string, record qualitySuiteRecord) (qualitySuiteRecord, error) {
	record = normalizeQualitySuiteRecord(record)
	if record.SuiteID == "" {
		return qualitySuiteRecord{}, fmt.Errorf("suiteId is required")
	}
	if err := writeQualityRecord(dir, "suites", record.SuiteID, record); err != nil {
		return qualitySuiteRecord{}, err
	}
	return record, nil
}

func upsertQualitySuiteCase(dir string, suiteID string, testCase qualitySuiteCase) (qualitySuiteRecord, error) {
	if suiteID == "" {
		return qualitySuiteRecord{}, fmt.Errorf("suiteId is required")
	}
	testCase = normalizeQualitySuiteCase(testCase)
	if testCase.CaseID == "" {
		return qualitySuiteRecord{}, fmt.Errorf("caseId is required")
	}
	record, err := readQualitySuiteRecord(dir, suiteID)
	if err != nil {
		record = qualitySuiteRecord{Tag: "QualitySuite", SuiteID: suiteID, Source: "json"}
	}
	replaced := false
	for index, existing := range record.Cases {
		if normalizeQualitySuiteCase(existing).CaseID == testCase.CaseID {
			record.Cases[index] = testCase
			replaced = true
			break
		}
	}
	if !replaced {
		record.Cases = append(record.Cases, testCase)
	}
	return saveQualitySuite(dir, record)
}

func readQualitySuiteRecord(dir string, suiteID string) (qualitySuiteRecord, error) {
	content, err := os.ReadFile(filepath.Join(dir, "suites", safeQualityFileName(suiteID)+".json"))
	if err != nil {
		return qualitySuiteRecord{}, err
	}
	var record qualitySuiteRecord
	if err := json.Unmarshal(content, &record); err != nil {
		return qualitySuiteRecord{}, err
	}
	return normalizeQualitySuiteRecord(record), nil
}

func normalizeQualitySuiteRecord(record qualitySuiteRecord) qualitySuiteRecord {
	record.Tag = "QualitySuite"
	if record.SuiteID == "" {
		record.SuiteID = record.ID
	}
	record.ID = ""
	if record.Source == "" {
		record.Source = "json"
	}
	if record.State == "" {
		record.State = "pinned"
	}
	for index, testCase := range record.Cases {
		record.Cases[index] = normalizeQualitySuiteCase(testCase)
	}
	record.CaseCount = len(record.Cases)
	return record
}

func normalizeQualitySuiteCase(testCase qualitySuiteCase) qualitySuiteCase {
	if testCase.CaseID == "" {
		testCase.CaseID = testCase.ID
	}
	testCase.ID = ""
	if testCase.Assertions == nil {
		testCase.Assertions = []qualitySuiteAssertion{}
	}
	return testCase
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
