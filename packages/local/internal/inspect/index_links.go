package inspect

import (
	"regexp"
	"strings"
)

var inspectIndexSafeIDPattern = regexp.MustCompile(`[^a-zA-Z0-9_.:-]+`)

func inspectTargetDefinitionIDs(targetID string) []string {
	safe := safeInspectIndexID(targetID)
	if safe == "" {
		return nil
	}
	return []string{safe, "prompt:" + safe, "flow:" + safe, "agent:" + safe, "rag.pipeline:" + safe, "tool:" + safe}
}

func safeInspectIndexID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	return strings.Trim(inspectIndexSafeIDPattern.ReplaceAllString(trimmed, "-"), "-")
}

func appendInspectUniqueString(values []string, value string) []string {
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
