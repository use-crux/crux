package observability

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func (s *Service) Ingest(ctx context.Context, batch Batch) error {
	err := s.ingest(ctx, batch)
	var evidenceError *evidenceDispositionError
	if errors.As(err, &evidenceError) &&
		evidenceError.code == evidenceStagingCapacityCode {
		if healthErr := s.recordEvidenceIngestHealthOutsideTransaction(
			context.Background(),
			evidenceStagingCapacityCode,
			1,
		); healthErr != nil {
			return fmt.Errorf("%w; %v", err, healthErr)
		}
	}
	var conflict *recordIDConflictError
	if err == nil || !errors.As(err, &conflict) {
		return err
	}
	for _, record := range batch.Records {
		if record.RecordID == conflict.recordID {
			if healthErr := s.recordIngestConflictHealth(context.Background(), record); healthErr != nil {
				return fmt.Errorf("%w; %v", err, healthErr)
			}
			break
		}
	}
	return err
}

func (s *Service) ingest(ctx context.Context, batch Batch) (err error) {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()

	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	if err := s.cleanupEvidenceCandidatesForBatch(ctx, batch); err != nil {
		return err
	}

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

	operationTraceIDs := make(map[string]string)
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
			operationTraceIDs[record.OperationID] = record.TraceID
		} else if _, ok := operationTraceIDs[record.OperationID]; !ok {
			operationTraceIDs[record.OperationID] = ""
		}
	}
	for spanID := range tokenChunkSpans {
		if err := enforceTokenChunkRing(ctx, statements, spanID); err != nil {
			return err
		}
	}
	if err := statements.reconcileAffected(ctx); err != nil {
		return fmt.Errorf("reconcile observability run/segment lifecycle: %w", err)
	}

	affectedOperationIDs := make([]string, 0, len(statements.affectedOperations))
	for operationID := range statements.affectedOperations {
		affectedOperationIDs = append(affectedOperationIDs, operationID)
	}
	revisions, err := bumpRunRevisions(ctx, tx, affectedOperationIDs, s.revisionLogRetentionOrDefault())
	if err != nil {
		return fmt.Errorf("advance observability run revisions: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit observability ingest transaction: %w", err)
	}
	committed = true
	s.publishIngestEvents(operationTraceIDs, tokenChunks, revisions)
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

// publishIngestEvents runs only after the ingest transaction has committed,
// so a subscriber never observes a revision or run id that references
// projections it cannot yet query.
func (s *Service) publishIngestEvents(operationTraceIDs map[string]string, tokenChunks []SpanEventRecord, revisions map[string]int64) {
	now := time.Now().UnixMilli()
	for operationID, traceID := range operationTraceIDs {
		payloadMap := map[string]any{"operationId": operationID, "entity": "operation"}
		if traceID != "" {
			payloadMap["traceId"] = traceID
		}
		if revision, ok := revisions[operationID]; ok {
			payloadMap["revision"] = revision
		}
		payload, _ := json.Marshal(payloadMap)
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("observability:%s:%d", operationID, now),
			Timestamp: now,
			Kind:      "observability.records",
			Action:    "ingested",
			Severity:  "info",
			RefID:     operationID,
			Payload:   payload,
		})
	}
	s.enqueueTokenChunkEvents(tokenChunks)
}
