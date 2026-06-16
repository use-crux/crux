package quality

import "github.com/use-crux/crux/packages/local/internal/qualityfs"

func qualityFeedbackIDsByTrace(dir string) (map[string][]string, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		return nil, err
	}
	return snapshot.ByTrace.FeedbackIDs, nil
}

func qualityExperimentIDsByTrace(dir string) (map[string][]string, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		return nil, err
	}
	return snapshot.ByTrace.ExperimentIDs, nil
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

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
