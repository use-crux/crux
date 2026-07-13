package observability

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

const maxIngestHealthMessageLength = 240
const maxIngestHealthRows = 1000
const maxSourceHealthRows = 256

var healthTokenPattern = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`)
var healthURLPattern = regexp.MustCompile(`(?i)https?://\S+`)
var healthBearerPattern = regexp.MustCompile(`(?i)bearer\s+\S+`)

// IngestDisposition accounts for one record at its submitted batch index.
type IngestDisposition struct {
	Index     int    `json:"index"`
	RecordID  string `json:"recordId"`
	Outcome   string `json:"outcome"`
	Code      string `json:"code"`
	Message   string `json:"message,omitempty"`
	Retryable bool   `json:"retryable"`
}

// IngestWithDispositions isolates record failures so valid siblings commit and
// every input index receives an explicit, privacy-bounded outcome.
func (s *Service) IngestWithDispositions(ctx context.Context, batch Batch) []IngestDisposition {
	if err := s.ingest(ctx, batch); err == nil {
		dispositions := make([]IngestDisposition, len(batch.Records))
		for index, record := range batch.Records {
			dispositions[index] = IngestDisposition{
				Index: index, RecordID: record.RecordID, Outcome: "accepted", Code: "accepted", Retryable: false,
			}
		}
		return dispositions
	}

	dispositions := make([]IngestDisposition, 0, len(batch.Records))
	for index, record := range batch.Records {
		if err := ValidateRecord(record); err != nil {
			dispositions = append(dispositions, rejectedDisposition(index, record.RecordID, "invalid_record", false))
			continue
		}
		if err := s.Ingest(ctx, Batch{SchemaVersion: SchemaVersion, Records: []Record{record}}); err != nil {
			code, retryable := classifyIngestDisposition(err)
			dispositions = append(dispositions, rejectedDisposition(index, record.RecordID, code, retryable))
			continue
		}
		dispositions = append(dispositions, IngestDisposition{
			Index: index, RecordID: record.RecordID, Outcome: "accepted", Code: "accepted", Retryable: false,
		})
	}
	return dispositions
}

// RecordSourceHealth persists only bounded counters, codes, and sanitized
// messages. Canonical prompts, outputs, baggage, and record payloads are never
// accepted by this side channel.
func (s *Service) RecordSourceHealth(ctx context.Context, health SourceHealth) error {
	if err := validateSourceHealth(health); err != nil {
		return err
	}
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	var code, message string
	if health.LastError != nil {
		code = sanitizeHealthToken(health.LastError.Code, 80)
		message = sanitizeHealthMessage(health.LastError.Message)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO observability_source_health (
			source_id, accepted, retried, permanently_rejected,
			overflow_dropped, deadline_dropped, last_error_code, last_error_message
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_id) DO UPDATE SET
			accepted = max(observability_source_health.accepted, excluded.accepted),
			retried = max(observability_source_health.retried, excluded.retried),
			permanently_rejected = max(observability_source_health.permanently_rejected, excluded.permanently_rejected),
			overflow_dropped = max(observability_source_health.overflow_dropped, excluded.overflow_dropped),
			deadline_dropped = max(observability_source_health.deadline_dropped, excluded.deadline_dropped),
			last_error_code = coalesce(excluded.last_error_code, observability_source_health.last_error_code),
			last_error_message = coalesce(excluded.last_error_message, observability_source_health.last_error_message),
			updated_at = CURRENT_TIMESTAMP
	`, health.SourceID, health.Accepted, health.Retried, health.PermanentlyRejected,
		health.OverflowDropped, health.DeadlineDropped, nullIfEmpty(code), nullIfEmpty(message))
	if err != nil {
		return fmt.Errorf("persist observability source health: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM observability_source_health
		WHERE source_id IN (
			SELECT source_id FROM observability_source_health
			ORDER BY updated_at DESC, source_id DESC
			LIMIT -1 OFFSET ?
		)
	`, maxSourceHealthRows); err != nil {
		return fmt.Errorf("bound observability source health: %w", err)
	}
	return nil
}

func (s *Service) recordIngestConflictHealth(ctx context.Context, record Record) error {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ingest_health (code, record_id, run_id, message)
		VALUES ('record_id_conflict', ?, ?, 'record ID reused with different canonical content')
		ON CONFLICT(code, record_id) DO UPDATE SET
			occurrence_count = ingest_health.occurrence_count + 1,
			last_seen_at = CURRENT_TIMESTAMP
	`, record.RecordID, nullIfEmpty(record.RunID))
	if err != nil {
		return fmt.Errorf("persist record identity conflict health: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM ingest_health
		WHERE (code, record_id) IN (
			SELECT code, record_id FROM ingest_health
			ORDER BY last_seen_at DESC, code DESC, record_id DESC
			LIMIT -1 OFFSET ?
		)
	`, maxIngestHealthRows); err != nil {
		return fmt.Errorf("bound record identity conflict health: %w", err)
	}
	return nil
}

func rejectedDisposition(index int, recordID, code string, retryable bool) IngestDisposition {
	return IngestDisposition{
		Index: index, RecordID: recordID, Outcome: "rejected", Code: code,
		Message: dispositionMessage(code), Retryable: retryable,
	}
}

func classifyIngestDisposition(err error) (string, bool) {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "record_id_conflict"):
		return "record_id_conflict", false
	case strings.Contains(message, "segment_ownership_conflict"):
		return "segment_ownership_conflict", false
	case strings.Contains(message, "segment_sequence_conflict"):
		return "segment_sequence_conflict", false
	case strings.Contains(message, "validate observability record"):
		return "invalid_record", false
	default:
		return "ingest_unavailable", true
	}
}

func dispositionMessage(code string) string {
	switch code {
	case "record_id_conflict":
		return "record ID reused with different canonical content"
	case "segment_ownership_conflict":
		return "segment ID already belongs to another run"
	case "segment_sequence_conflict":
		return "segment sequence already identifies another record"
	case "invalid_record":
		return "record failed canonical validation"
	default:
		return "observability ingest is temporarily unavailable"
	}
}

func validateSourceHealth(health SourceHealth) error {
	if health.SourceID == "" || len(health.SourceID) > 128 || sanitizeHealthToken(health.SourceID, 128) != health.SourceID {
		return fmt.Errorf("invalid observability source health id")
	}
	if health.Accepted < 0 || health.Retried < 0 || health.PermanentlyRejected < 0 || health.OverflowDropped < 0 || health.DeadlineDropped < 0 {
		return fmt.Errorf("invalid negative observability source health counter")
	}
	return nil
}

func sanitizeHealthToken(value string, maximum int) string {
	value = healthTokenPattern.ReplaceAllString(value, "_")
	if len(value) > maximum {
		value = value[:maximum]
	}
	return value
}

func sanitizeHealthMessage(value string) string {
	value = healthURLPattern.ReplaceAllString(value, "[url]")
	value = healthBearerPattern.ReplaceAllString(value, "Bearer [redacted]")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	runes := []rune(value)
	if len(runes) > maxIngestHealthMessageLength {
		value = string(runes[:maxIngestHealthMessageLength])
	}
	return value
}
