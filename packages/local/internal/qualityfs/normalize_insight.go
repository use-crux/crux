package qualityfs

import (
	"crypto/sha1"
	"encoding/hex"
	"strings"
)

func normalizeInsightSilencePattern(pattern InsightSilencePattern) InsightSilencePattern {
	pattern.Title = strings.TrimSpace(pattern.Title)
	pattern.TargetID = strings.TrimSpace(pattern.TargetID)
	return pattern
}

func NormalizeInsightSilencePattern(pattern InsightSilencePattern) InsightSilencePattern {
	return normalizeInsightSilencePattern(pattern)
}

func InsightSilenceID(pattern InsightSilencePattern) string {
	pattern = normalizeInsightSilencePattern(pattern)
	hash := sha1.Sum([]byte(pattern.Title + "\x00" + pattern.TargetID))
	return "silence-" + hex.EncodeToString(hash[:8])
}
