package quality

import (
	"regexp"
	"strings"
)

var qualityIndexSafeIDPattern = regexp.MustCompile(`[^a-zA-Z0-9_.:-]+`)

func qualityTargetDefinitionIDs(targetID string) []string {
	safe := safeQualityIndexID(targetID)
	if safe == "" {
		return nil
	}
	return []string{
		safe,
		"prompt:" + safe,
		"flow:" + safe,
		"agent:" + safe,
		"rag.pipeline:" + safe,
		"tool:" + safe,
	}
}

func experimentDefinitionIDs(experiment qualityExperimentRecord) []string {
	defIDs := []string{}
	if experiment.Suite.ID != "" {
		defIDs = append(defIDs, "suite:"+safeQualityIndexID(experiment.Suite.ID))
	}
	for _, variant := range experiment.Variants {
		defIDs = append(defIDs, qualityTargetDefinitionIDs(variant.TargetID)...)
	}
	return defIDs
}

func safeQualityIndexID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	safe := qualityIndexSafeIDPattern.ReplaceAllString(trimmed, "-")
	return strings.Trim(safe, "-")
}

func appendQualityUniqueString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
