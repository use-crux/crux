package indexread

import (
	"encoding/json"
)

func readQualityExperimentRecords(dir string) ([]qualityExperimentRecord, error) {
	raw, err := readQualityRecords(dir, "experiments")
	if err != nil {
		return nil, err
	}
	experiments := make([]qualityExperimentRecord, 0, len(raw))
	for _, item := range raw {
		var experiment qualityExperimentRecord
		if err := json.Unmarshal(item, &experiment); err != nil {
			return nil, err
		}
		experiments = append(experiments, experiment)
	}
	return experiments, nil
}

func readQualitySuiteRecords(dir string) ([]qualitySuiteRecord, error) {
	raw, err := readQualityRecords(dir, "suites")
	if err != nil {
		return nil, err
	}
	suites := make([]qualitySuiteRecord, 0, len(raw))
	for _, item := range raw {
		var suite qualitySuiteRecord
		if err := json.Unmarshal(item, &suite); err != nil {
			return nil, err
		}
		suites = append(suites, suite)
	}
	return suites, nil
}

func appendUniqueStrings(values []string, nextValues ...string) []string {
	for _, value := range nextValues {
		values = appendQualityUniqueString(values, value)
	}
	return values
}

func appendQualityUniqueStrings(values []string, nextValues ...string) []string {
	for _, value := range nextValues {
		values = appendQualityUniqueString(values, value)
	}
	return values
}

func safeQualityFileName(value string) string {
	safe := safeQualityIndexID(value)
	if safe == "" {
		return "unnamed"
	}
	return safe
}

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
