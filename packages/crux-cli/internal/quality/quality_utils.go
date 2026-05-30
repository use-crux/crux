package quality

import (
	"strings"
)

func qualityFeedbackIDsByTrace(dir string) (map[string][]string, error) {
	feedback, err := readQualityFeedbackRecords(dir)
	if err != nil {
		return nil, err
	}
	byTrace := map[string][]string{}
	for _, item := range feedback {
		if item.TraceID == nil || *item.TraceID == "" {
			continue
		}
		byTrace[*item.TraceID] = appendUniqueString(byTrace[*item.TraceID], item.ID)
	}
	return byTrace, nil
}

func qualityExperimentIDsByTrace(dir string) (map[string][]string, error) {
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
	byTrace := map[string][]string{}
	for _, experiment := range experiments {
		for _, testCase := range experiment.Cases {
			if testCase.TraceID == "" {
				continue
			}
			byTrace[testCase.TraceID] = appendUniqueString(byTrace[testCase.TraceID], experiment.ID)
		}
	}
	return byTrace, nil
}

func qualityExperimentSortKey(experiment qualityExperimentRecord) string {
	return nonEmptyString(experiment.EndedAt, experiment.StartedAt, experiment.ID)
}

func passRateFromSummary(passed int, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(passed) / float64(total)
}

func qualityFailureSeverity(errored int) string {
	if errored > 0 {
		return "high"
	}
	return "medium"
}

func cassetteStatusForPaths(paths []string) string {
	if len(paths) == 0 {
		return ""
	}
	return "recorded"
}

func appendUniqueString(values []string, next string) []string {
	if next == "" {
		return values
	}
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func appendUniqueStrings(values []string, nextValues ...string) []string {
	for _, next := range nextValues {
		values = appendUniqueString(values, next)
	}
	return values
}

func safeQualityFileName(value string) string {
	value = strings.ToLower(value)
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "record"
	}
	if len(result) > 180 {
		return result[:180]
	}
	return result
}

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
