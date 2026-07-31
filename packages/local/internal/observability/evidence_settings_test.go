package observability

import (
	"context"
	"database/sql"
	"math"
	"strings"
	"testing"
	"time"
)

func TestEvidenceSettingsDefaultsToObservabilityRetention(t *testing.T) {
	settings, warning, err := evidenceSettingsFromEnv(retentionSettings{
		MaxRunAge: 21 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	if warning != "" {
		t.Fatalf("unexpected warning %q", warning)
	}
	if settings.RelationshipRetention != 21*24*time.Hour {
		t.Fatalf("relationship retention = %s", settings.RelationshipRetention)
	}
	if settings.PayloadRetention != settings.RelationshipRetention {
		t.Fatalf("payload retention = %s, want relationship retention", settings.PayloadRetention)
	}
	if settings.StagingTTL != 24*time.Hour {
		t.Fatalf("staging TTL = %s, want 24h", settings.StagingTTL)
	}
}

func TestEvidenceSettingsOverridesAndClampsPayload(t *testing.T) {
	t.Setenv("CRUX_EVIDENCE_RETENTION_DAYS", "30")
	t.Setenv("CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS", "45")

	settings, warning, err := evidenceSettingsFromEnv(retentionSettings{
		MaxRunAge: 14 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.RelationshipRetention != 30*24*time.Hour {
		t.Fatalf("relationship retention = %s", settings.RelationshipRetention)
	}
	if settings.PayloadRetention != settings.RelationshipRetention {
		t.Fatalf("payload retention = %s, want clamp to %s", settings.PayloadRetention, settings.RelationshipRetention)
	}
	if warning != evidencePayloadRetentionClampWarning {
		t.Fatalf("warning = %q, want bounded clamp warning", warning)
	}
	if strings.Contains(warning, "30") || strings.Contains(warning, "45") {
		t.Fatalf("warning exposed configuration values: %q", warning)
	}
}

func TestEvidenceSettingsClampsStagingTTL(t *testing.T) {
	t.Setenv("CRUX_EVIDENCE_RETENTION_DAYS", "3")
	t.Setenv("CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS", "1")

	settings, _, err := evidenceSettingsFromEnv(retentionSettings{})
	if err != nil {
		t.Fatal(err)
	}
	if settings.StagingTTL != 24*time.Hour {
		t.Fatalf("staging TTL = %s, want one-day payload retention", settings.StagingTTL)
	}
}

func TestEvidenceSettingsRejectsInvalidExplicitValues(t *testing.T) {
	overflowDays := uint64(math.MaxInt64/int64(24*time.Hour)) + 1
	for name, value := range map[string]string{
		"zero":       "0",
		"negative":   "-1",
		"fractional": "1.5",
		"text":       "forever",
		"overflow":   "999999999999999999999999999999999999",
		"duration":   "24h",
		"too large":  stringUint(overflowDays),
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("CRUX_EVIDENCE_RETENTION_DAYS", value)
			_, _, err := evidenceSettingsFromEnv(retentionSettings{})
			if err == nil {
				t.Fatalf("accepted invalid evidence retention %q", value)
			}
			if !strings.Contains(err.Error(), "CRUX_EVIDENCE_RETENTION_DAYS") {
				t.Fatalf("error %q omitted setting name", err)
			}
		})
	}
}

func TestEvidenceSettingsRejectsInvalidPayloadValue(t *testing.T) {
	t.Setenv("CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS", "0")
	if _, _, err := evidenceSettingsFromEnv(retentionSettings{}); err == nil {
		t.Fatal("accepted zero payload retention")
	}
}

func TestEvidenceSettingsFailServiceStartupBeforeSQLiteMutation(t *testing.T) {
	t.Setenv("CRUX_EVIDENCE_RETENTION_DAYS", "0")
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := NewService(db); err == nil {
		t.Fatal("service startup accepted invalid evidence retention")
	}
	var tableCount int
	if err := db.QueryRow(`
		SELECT count(*) FROM sqlite_master WHERE type = 'table'
	`).Scan(&tableCount); err != nil {
		t.Fatal(err)
	}
	if tableCount != 0 {
		t.Fatalf("invalid startup created %d SQLite tables", tableCount)
	}
}

func TestEvidenceSettingsServiceOptionsKeepTestClockAndDurationsPrivate(t *testing.T) {
	t.Setenv(evidenceRelationshipRetentionEnv, "invalid")
	t.Setenv(evidencePayloadRetentionEnv, "invalid")
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	now := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	warnings := []string{}
	service, err := newServiceWithOptions(
		context.Background(),
		db,
		inMemoryMaxOpenConns,
		serviceOptions{
			evidenceNow: func() time.Time { return now },
			evidenceSettings: &evidenceSettings{
				RelationshipRetention: 2 * time.Hour,
				PayloadRetention:      3 * time.Hour,
				StagingTTL:            4 * time.Hour,
			},
			warn: func(message string) {
				warnings = append(warnings, message)
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := service.evidenceNow(); !got.Equal(now) {
		t.Fatalf("service evidence clock = %s, want %s", got, now)
	}
	if got := service.evidenceSettings; got != (evidenceSettings{
		RelationshipRetention: 2 * time.Hour,
		PayloadRetention:      2 * time.Hour,
		StagingTTL:            2 * time.Hour,
	}) {
		t.Fatalf("service evidence settings = %#v", got)
	}
	if len(warnings) != 1 || warnings[0] != evidencePayloadRetentionClampWarning {
		t.Fatalf("startup warnings = %#v", warnings)
	}
}

func stringUint(value uint64) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	buffer := make([]byte, 0, 20)
	for value > 0 {
		buffer = append(buffer, digits[value%10])
		value /= 10
	}
	for left, right := 0, len(buffer)-1; left < right; left, right = left+1, right-1 {
		buffer[left], buffer[right] = buffer[right], buffer[left]
	}
	return string(buffer)
}
