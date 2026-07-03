package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRetentionMaxRunAge       = 14 * 24 * time.Hour
	defaultRetentionMaxRuns         = 2000
	defaultArtifactPreviewMaxBytes  = 256 * 1024
	retentionDeleteBatchSize        = 50
	retentionIncrementalVacuumPages = 2048
)

type retentionSettings struct {
	MaxRunAge       time.Duration
	MaxRuns         int
	PreviewMaxBytes int
}

func retentionSettingsFromEnv() retentionSettings {
	settings := retentionSettings{
		MaxRunAge:       defaultRetentionMaxRunAge,
		MaxRuns:         defaultRetentionMaxRuns,
		PreviewMaxBytes: defaultArtifactPreviewMaxBytes,
	}
	if days, ok := positiveIntEnv("CRUX_OBSERVABILITY_RETENTION_DAYS"); ok {
		settings.MaxRunAge = time.Duration(days) * 24 * time.Hour
	}
	if runs, ok := positiveIntEnv("CRUX_OBSERVABILITY_RETENTION_RUNS"); ok {
		settings.MaxRuns = runs
	}
	if bytes, ok := positiveIntEnv("CRUX_OBSERVABILITY_PREVIEW_MAX_BYTES"); ok {
		settings.PreviewMaxBytes = bytes
	}
	return settings
}

func positiveIntEnv(name string) (int, bool) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}

func normalizeRetentionSettings(settings retentionSettings) retentionSettings {
	if settings.MaxRunAge <= 0 {
		settings.MaxRunAge = defaultRetentionMaxRunAge
	}
	if settings.MaxRuns <= 0 {
		settings.MaxRuns = defaultRetentionMaxRuns
	}
	if settings.PreviewMaxBytes <= 0 {
		settings.PreviewMaxBytes = defaultArtifactPreviewMaxBytes
	}
	return settings
}

func (s *Service) StartRetention(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	settings := s.retentionSettings
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = s.runRetention(ctx, settings, time.Now().UTC())
			}
		}
	}()
}

func (s *Service) applyRetentionIngestPolicy(record Record) Record {
	if record.Type != RecordArtifact {
		return record
	}
	capBytes := normalizeRetentionSettings(s.retentionSettings).PreviewMaxBytes
	artifact, changed, err := cappedArtifactRecord(record.Payload, capBytes)
	if err != nil || !changed {
		return record
	}
	payload, err := json.Marshal(artifact)
	if err != nil {
		return record
	}
	record.Payload = payload
	return record
}

func cappedArtifactRecord(payload json.RawMessage, capBytes int) (ArtifactRecord, bool, error) {
	var artifact ArtifactRecord
	if err := json.Unmarshal(payload, &artifact); err != nil {
		return ArtifactRecord{}, false, err
	}
	capped, changed := cappedArtifactPreview(artifact.Preview, capBytes)
	if changed {
		artifact.Preview = capped
	}
	return artifact, changed, nil
}

func cappedArtifactPreview(preview json.RawMessage, capBytes int) (json.RawMessage, bool) {
	if capBytes <= 0 || len(preview) <= capBytes {
		return preview, false
	}
	replacement, err := json.Marshal(map[string]any{
		"__crux_truncated": true,
		"bytes":            len(preview),
	})
	if err != nil {
		return preview, false
	}
	return json.RawMessage(replacement), true
}

func (s *Service) runRetention(ctx context.Context, settings retentionSettings, now time.Time) (int, error) {
	settings = normalizeRetentionSettings(settings)
	ctx, cancel := s.maintenanceContext(ctx)
	defer cancel()

	deleteIDs, err := s.retentionRunIDsByAge(ctx, now.Add(-settings.MaxRunAge), retentionDeleteBatchSize)
	if err != nil {
		return 0, err
	}
	if len(deleteIDs) < retentionDeleteBatchSize {
		remaining := retentionDeleteBatchSize - len(deleteIDs)
		ids, err := s.retentionRunIDsByCount(ctx, settings.MaxRuns, deleteIDs, remaining)
		if err != nil {
			return 0, err
		}
		deleteIDs = append(deleteIDs, ids...)
	}
	if len(deleteIDs) == 0 {
		return 0, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin observability retention transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if err := deleteRunRows(ctx, tx, deleteIDs); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit observability retention transaction: %w", err)
	}
	committed = true
	if _, err := s.db.ExecContext(ctx, fmt.Sprintf(`PRAGMA incremental_vacuum(%d)`, retentionIncrementalVacuumPages)); err != nil {
		return 0, fmt.Errorf("vacuum observability retention pages: %w", err)
	}
	return len(deleteIDs), nil
}

func (s *Service) retentionRunIDsByAge(ctx context.Context, cutoff time.Time, limit int) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id
		FROM runs
		WHERE started_at IS NOT NULL AND started_at != '' AND started_at < ?
		ORDER BY started_at ASC, run_id ASC
		LIMIT ?
	`, cutoff.UTC().Format(time.RFC3339Nano), limit)
	if err != nil {
		return nil, fmt.Errorf("query age-retained observability runs: %w", err)
	}
	defer rows.Close()
	return scanRetentionRunIDs(rows)
}

func (s *Service) retentionRunIDsByCount(ctx context.Context, maxRuns int, excluded []string, limit int) ([]string, error) {
	if limit <= 0 {
		return nil, nil
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM runs`).Scan(&total); err != nil {
		return nil, fmt.Errorf("count observability runs for retention: %w", err)
	}
	overflow := total - len(excluded) - maxRuns
	if overflow <= 0 {
		return nil, nil
	}
	if overflow > limit {
		overflow = limit
	}
	query := `
		SELECT run_id
		FROM runs`
	args := make([]any, 0, len(excluded)+1)
	if len(excluded) > 0 {
		query += ` WHERE run_id NOT IN (` + strings.TrimRight(strings.Repeat("?,", len(excluded)), ",") + `)`
		for _, id := range excluded {
			args = append(args, id)
		}
	}
	query += ` ORDER BY started_at ASC, run_id ASC LIMIT ?`
	args = append(args, overflow)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query count-retained observability runs: %w", err)
	}
	defer rows.Close()
	return scanRetentionRunIDs(rows)
}

func scanRetentionRunIDs(rows *sql.Rows) ([]string, error) {
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
