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

	runTraceIDs := make(map[string]string)
	tokenDeltas := make([]SpanEventRecord, 0)
	for _, record := range batch.Records {
		if err := ValidateRecord(record); err != nil {
			return fmt.Errorf("validate observability record %q: %w", record.RecordID, err)
		}
		if !isKnownRecordType(record.Type) {
			s.unknownRecordTypes.Add(1)
		}
		if token, ok := tokenDeltaRecord(record); ok {
			tokenDeltas = append(tokenDeltas, token)
		}
		if err := s.ingestRecord(ctx, tx, record); err != nil {
			return fmt.Errorf("ingest observability record %q: %w", record.RecordID, err)
		}
		if record.TraceID != "" {
			runTraceIDs[record.RunID] = record.TraceID
		} else if _, ok := runTraceIDs[record.RunID]; !ok {
			runTraceIDs[record.RunID] = ""
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit observability ingest transaction: %w", err)
	}
	committed = true
	s.publishIngestEvents(runTraceIDs, tokenDeltas)
	return nil
}

func tokenDeltaRecord(record Record) (SpanEventRecord, bool) {
	if record.Type != RecordSpanEvent {
		return SpanEventRecord{}, false
	}
	var event SpanEventRecord
	if err := json.Unmarshal(record.Payload, &event); err != nil {
		return SpanEventRecord{}, false
	}
	return event, event.Name == "token.delta"
}

func (s *Service) publishIngestEvents(runTraceIDs map[string]string, tokenDeltas []SpanEventRecord) {
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
	for _, token := range tokenDeltas {
		payload, _ := json.Marshal(map[string]any{
			"runId":      token.RunID,
			"traceId":    token.TraceID,
			"spanId":     token.SpanID,
			"eventId":    token.EventID,
			"timestamp":  token.Timestamp,
			"attributes": json.RawMessage(token.Attributes),
		})
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("token:%s:%s:%s", token.RunID, token.SpanID, token.EventID),
			Timestamp: now,
			Kind:      "token.delta",
			Action:    "appended",
			Severity:  "info",
			RefID:     token.RunID,
			Payload:   payload,
		})
	}
}
