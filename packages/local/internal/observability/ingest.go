package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

func (s *Service) Ingest(ctx context.Context, batch Batch) (err error) {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()

	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin observability ingest transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			if rollbackErr := tx.Rollback(); rollbackErr != nil && err == nil {
				err = fmt.Errorf("rollback observability ingest transaction: %w", rollbackErr)
			}
		}
	}()
	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()

	runTraceIDs := make(map[string]string)
	tokenChunks := make([]SpanEventRecord, 0)
	tokenChunkSpans := make(map[string]struct{})
	for _, record := range batch.Records {
		if err := ValidateRecord(record); err != nil {
			return fmt.Errorf("validate observability record %q: %w", record.RecordID, err)
		}
		record = s.applyRetentionIngestPolicy(record)
		if !isKnownRecordType(record.Type) {
			s.unknownRecordTypes.Add(1)
		}
		if token, ok := tokenChunkRecord(record); ok {
			tokenChunks = append(tokenChunks, token)
			tokenChunkSpans[token.SpanID] = struct{}{}
		}
		if err := s.ingestRecord(ctx, tx, statements, record); err != nil {
			return fmt.Errorf("ingest observability record %q: %w", record.RecordID, err)
		}
		if record.TraceID != "" {
			runTraceIDs[record.RunID] = record.TraceID
		} else if _, ok := runTraceIDs[record.RunID]; !ok {
			runTraceIDs[record.RunID] = ""
		}
	}
	for spanID := range tokenChunkSpans {
		if err := enforceTokenChunkRing(ctx, statements, spanID); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit observability ingest transaction: %w", err)
	}
	committed = true
	s.publishIngestEvents(runTraceIDs, tokenChunks)
	return nil
}

func tokenChunkRecord(record Record) (SpanEventRecord, bool) {
	if record.Type != RecordSpanEvent {
		return SpanEventRecord{}, false
	}
	var event SpanEventRecord
	if err := json.Unmarshal(record.Payload, &event); err != nil {
		return SpanEventRecord{}, false
	}
	return event, event.Name == tokenChunkEventName
}

func (s *Service) publishIngestEvents(runTraceIDs map[string]string, tokenChunks []SpanEventRecord) {
	now := time.Now().UnixMilli()
	for runID, traceID := range runTraceIDs {
		payloadMap := map[string]any{"runId": runID}
		if traceID != "" {
			payloadMap["traceId"] = traceID
		}
		payload, _ := json.Marshal(payloadMap)
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("observability:%s:%d", runID, now),
			Timestamp: now,
			Kind:      "observability.records",
			Action:    "ingested",
			Severity:  "info",
			RefID:     runID,
			Payload:   payload,
		})
	}
	s.enqueueTokenChunkEvents(tokenChunks)
}
