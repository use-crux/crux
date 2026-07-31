package observability

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	evidenceRelationshipRetentionEnv     = "CRUX_EVIDENCE_RETENTION_DAYS"
	evidencePayloadRetentionEnv          = "CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS"
	defaultEvidenceStagingTTL            = 24 * time.Hour
	evidencePayloadRetentionClampWarning = "evidence payload retention exceeds relationship retention; clamping payload retention"
)

// evidenceSettings owns Local-only evidence lifecycle durations. Public
// environment values remain whole days; tests may inject shorter durations
// through the private service construction options.
type evidenceSettings struct {
	RelationshipRetention time.Duration
	PayloadRetention      time.Duration
	StagingTTL            time.Duration
}

func evidenceSettingsFromEnv(
	observability retentionSettings,
) (evidenceSettings, string, error) {
	relationshipRetention := normalizeRetentionSettings(observability).MaxRunAge
	if value, present := os.LookupEnv(evidenceRelationshipRetentionEnv); present {
		duration, err := parsePositiveEvidenceDays(evidenceRelationshipRetentionEnv, value)
		if err != nil {
			return evidenceSettings{}, "", err
		}
		relationshipRetention = duration
	}

	payloadRetention := relationshipRetention
	if value, present := os.LookupEnv(evidencePayloadRetentionEnv); present {
		duration, err := parsePositiveEvidenceDays(evidencePayloadRetentionEnv, value)
		if err != nil {
			return evidenceSettings{}, "", err
		}
		payloadRetention = duration
	}

	settings, warning, err := normalizeEvidenceSettings(evidenceSettings{
		RelationshipRetention: relationshipRetention,
		PayloadRetention:      payloadRetention,
		StagingTTL:            defaultEvidenceStagingTTL,
	})
	return settings, warning, err
}

func normalizeEvidenceSettings(
	settings evidenceSettings,
) (evidenceSettings, string, error) {
	if settings.RelationshipRetention <= 0 {
		return evidenceSettings{}, "", fmt.Errorf(
			"evidence relationship retention must be positive",
		)
	}
	if settings.PayloadRetention <= 0 {
		return evidenceSettings{}, "", fmt.Errorf(
			"evidence payload retention must be positive",
		)
	}
	if settings.StagingTTL <= 0 {
		return evidenceSettings{}, "", fmt.Errorf(
			"evidence staging TTL must be positive",
		)
	}
	warning := ""
	if settings.PayloadRetention > settings.RelationshipRetention {
		settings.PayloadRetention = settings.RelationshipRetention
		warning = evidencePayloadRetentionClampWarning
	}
	settings.StagingTTL = minDuration(
		settings.StagingTTL,
		settings.PayloadRetention,
		settings.RelationshipRetention,
	)
	return settings, warning, nil
}

func parsePositiveEvidenceDays(name, raw string) (time.Duration, error) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.IndexFunc(value, func(r rune) bool {
		return r < '0' || r > '9'
	}) != -1 {
		return 0, invalidEvidenceRetention(name)
	}
	days, err := strconv.ParseUint(value, 10, 64)
	maximumDays := uint64(math.MaxInt64 / int64(24*time.Hour))
	if err != nil || days == 0 || days > maximumDays {
		return 0, invalidEvidenceRetention(name)
	}
	return time.Duration(days) * 24 * time.Hour, nil
}

func invalidEvidenceRetention(name string) error {
	return fmt.Errorf(
		"%s must be a positive whole number of days that fits Local's duration range",
		name,
	)
}

func minDuration(first time.Duration, rest ...time.Duration) time.Duration {
	result := first
	for _, candidate := range rest {
		if candidate < result {
			result = candidate
		}
	}
	return result
}
