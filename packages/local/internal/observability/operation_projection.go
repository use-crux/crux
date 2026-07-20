package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

type operationMemberTopology struct {
	runID, operationID, parentRunID, triggeredBySpanID, traceID string
}

func (s *Service) enrichOperationSummaries(ctx context.Context, operations []RunSummary) error {
	if len(operations) == 0 {
		return nil
	}
	byOperationID := make(map[string]*RunSummary, len(operations))
	operationIDs := make([]string, 0, len(operations))
	for i := range operations {
		byOperationID[operations[i].OperationID] = &operations[i]
		operationIDs = append(operationIDs, operations[i].OperationID)
		operations[i].OrderingConfidence = "causal"
		operations[i].DeliveryHealth = &RunDeliveryHealth{Status: "unknown"}
	}
	for _, batch := range runIDBatches(operationIDs, runSummaryRollupBatchSize) {
		if err := s.enrichOperationSegmentBatch(ctx, batch, byOperationID); err != nil {
			return err
		}
		if err := s.enrichOperationDeliveryBatch(ctx, batch, byOperationID); err != nil {
			return err
		}
		if err := s.enrichOperationTopologyBatch(ctx, batch, byOperationID); err != nil {
			return err
		}
		if err := s.enrichOperationIdentityBatch(ctx, batch, byOperationID); err != nil {
			return err
		}
	}
	for i := range operations {
		if operations[i].DeliveryHealth.Status == "unknown" && isFullyDeliveredRun(&operations[i]) {
			operations[i].DeliveryHealth = &RunDeliveryHealth{Status: "healthy"}
		}
	}
	return nil
}

func (s *Service) enrichOperationIdentityBatch(ctx context.Context, operationIDs []string, byOperationID map[string]*RunSummary) error {
	metricsByOperation := make(map[string]map[string]float64, len(operationIDs))
	for _, operationID := range operationIDs {
		metricsByOperation[operationID] = map[string]float64{}
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.operation_id, ifnull(sp.model, ''), ifnull(sp.provider, ''), ifnull(sp.prompt_id, ''), sp.attributes_json, sp.metrics_json
		FROM spans sp JOIN runs m ON m.run_id = sp.run_id
		WHERE m.operation_id IN (`+queryPlaceholders(len(operationIDs))+`)
		ORDER BY m.operation_id, sp.started_at, sp.span_id
	`, queryArgs(operationIDs)...)
	if err != nil {
		return fmt.Errorf("query operation identities: %w", err)
	}
	for rows.Next() {
		var operationID, model, provider, promptID string
		var attributes, metrics []byte
		if err := rows.Scan(&operationID, &model, &provider, &promptID, &attributes, &metrics); err != nil {
			return err
		}
		operation := byOperationID[operationID]
		if operation == nil {
			continue
		}
		raw := json.RawMessage(attributes)
		if operation.Model == "" {
			operation.Model = firstNonEmpty(model, stringAttribute(raw, "model"), stringAttribute(raw, "actualModelId"), stringAttribute(raw, "selectedModel"))
		}
		if operation.Provider == "" {
			operation.Provider = firstNonEmpty(provider, stringAttribute(raw, "provider"))
		}
		if operation.PromptID == "" {
			operation.PromptID = firstNonEmpty(promptID, stringAttribute(raw, "promptId"))
		}
		addMetrics(metricsByOperation[operationID], metricsFromRaw(json.RawMessage(metrics)))
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	eventRows, err := s.db.QueryContext(ctx, `
		SELECT m.operation_id, e.attributes_json FROM span_events e JOIN runs m ON m.run_id = e.run_id
		WHERE m.operation_id IN (`+queryPlaceholders(len(operationIDs))+`) AND e.name = 'usage.observed'
	`, queryArgs(operationIDs)...)
	if err != nil {
		return err
	}
	for eventRows.Next() {
		var operationID string
		var attributes []byte
		if err := eventRows.Scan(&operationID, &attributes); err != nil {
			eventRows.Close()
			return err
		}
		addMetrics(metricsByOperation[operationID], metricsFromRaw(json.RawMessage(attributes)))
	}
	if err := eventRows.Close(); err != nil {
		return err
	}
	for operationID, operation := range byOperationID {
		metrics := numericMetricsFromRaw(operation.Metrics)
		mergeMissingOrZeroMetrics(metrics, metricsByOperation[operationID])
		normalizeUsageTotals(metrics)
		operation.Metrics = metricsRawOrNil(metrics)
	}
	return nil
}

func (s *Service) enrichOperationSegmentBatch(ctx context.Context, operationIDs []string, byOperationID map[string]*RunSummary) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.operation_id, count(seg.segment_id), ifnull(sum(seg.gap_count), 0), ifnull(sum(seg.conflict_count), 0),
			ifnull(sum(CASE WHEN seg.status = 'running' THEN 1 ELSE 0 END), 0),
			ifnull(max(CASE WHEN seg.status = 'running' THEN seg.segment_id ELSE '' END), '')
		FROM runs m LEFT JOIN run_segments seg ON seg.run_id = m.run_id
		WHERE m.operation_id IN (`+queryPlaceholders(len(operationIDs))+`)
		GROUP BY m.operation_id
	`, queryArgs(operationIDs)...)
	if err != nil {
		return fmt.Errorf("query operation segment rollups: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var operationID string
		var activeSegmentID string
		var segments, gaps, conflicts, running int
		if err := rows.Scan(&operationID, &segments, &gaps, &conflicts, &running, &activeSegmentID); err != nil {
			return err
		}
		operation := byOperationID[operationID]
		if operation == nil {
			continue
		}
		operation.SegmentCount = segments
		operation.GapCount = gaps
		if gaps > 0 || conflicts > 0 {
			operation.OrderingConfidence = "partial"
		}
		if running == 1 {
			operation.ActiveSegmentID = activeSegmentID
		}
	}
	return rows.Err()
}

func (s *Service) enrichOperationDeliveryBatch(ctx context.Context, operationIDs []string, byOperationID map[string]*RunSummary) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.operation_id, sum(h.occurrence_count), max(h.last_seen_at)
		FROM ingest_health h JOIN runs m ON m.run_id = h.run_id
		WHERE m.operation_id IN (`+queryPlaceholders(len(operationIDs))+`)
		GROUP BY m.operation_id
	`, queryArgs(operationIDs)...)
	if err != nil {
		return fmt.Errorf("query operation delivery health: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var operationID, lastSeenAt string
		var rejected int
		if err := rows.Scan(&operationID, &rejected, &lastSeenAt); err != nil {
			return err
		}
		if operation := byOperationID[operationID]; operation != nil {
			operation.DeliveryHealth = &RunDeliveryHealth{Status: "degraded", Rejected: rejected, LastKnownAt: lastSeenAt}
		}
	}
	return rows.Err()
}

func (s *Service) enrichOperationTopologyBatch(ctx context.Context, operationIDs []string, byOperationID map[string]*RunSummary) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, operation_id, ifnull(parent_run_id, ''), ifnull(triggered_by_span_id, ''), ifnull(trace_id, '')
		FROM runs WHERE operation_id IN (`+queryPlaceholders(len(operationIDs))+`)
	`, queryArgs(operationIDs)...)
	if err != nil {
		return fmt.Errorf("query operation topology: %w", err)
	}
	members := map[string]operationMemberTopology{}
	byFamily := map[string][]string{}
	triggerIDs := []string{}
	for rows.Next() {
		var member operationMemberTopology
		if err := rows.Scan(&member.runID, &member.operationID, &member.parentRunID, &member.triggeredBySpanID, &member.traceID); err != nil {
			rows.Close()
			return err
		}
		members[member.runID] = member
		byFamily[member.operationID] = append(byFamily[member.operationID], member.runID)
		if member.triggeredBySpanID != "" {
			triggerIDs = append(triggerIDs, member.triggeredBySpanID)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	triggerOwners := map[string]string{}
	if len(triggerIDs) > 0 {
		spanRows, err := s.db.QueryContext(ctx, `SELECT span_id, run_id FROM spans WHERE span_id IN (`+queryPlaceholders(len(triggerIDs))+`)`, queryArgs(triggerIDs)...)
		if err != nil {
			return err
		}
		for spanRows.Next() {
			var spanID, runID string
			if err := spanRows.Scan(&spanID, &runID); err != nil {
				spanRows.Close()
				return err
			}
			triggerOwners[spanID] = runID
		}
		if err := spanRows.Close(); err != nil {
			return err
		}
	}
	for operationID, runIDs := range byFamily {
		health := "healthy"
		if operation := byOperationID[operationID]; operation != nil && !operation.RootPresent {
			health = "incomplete"
		}
		for _, runID := range runIDs {
			member := members[runID]
			if runID == operationID {
				if member.parentRunID != "" {
					health = "conflicted"
				}
				continue
			}
			if member.parentRunID == "" || member.triggeredBySpanID == "" {
				if health != "conflicted" {
					health = "incomplete"
				}
				continue
			}
			parent, ok := members[member.parentRunID]
			if member.parentRunID == runID || (ok && (parent.operationID != operationID || (parent.traceID != "" && member.traceID != "" && parent.traceID != member.traceID))) {
				health = "conflicted"
				continue
			}
			if !ok || triggerOwners[member.triggeredBySpanID] != member.parentRunID {
				if health != "conflicted" {
					health = "incomplete"
				}
			}
		}
		if topologyHasCycle(operationID, members, runIDs) {
			health = "conflicted"
		}
		if operation := byOperationID[operationID]; operation != nil {
			operation.TopologyHealth = health
		}
	}
	return nil
}

func topologyHasCycle(operationID string, members map[string]operationMemberTopology, runIDs []string) bool {
	for _, start := range runIDs {
		seen := map[string]struct{}{}
		for current := start; current != "" && current != operationID; {
			if _, exists := seen[current]; exists {
				return true
			}
			seen[current] = struct{}{}
			member, exists := members[current]
			if !exists || member.operationID != operationID {
				break
			}
			current = member.parentRunID
		}
	}
	return false
}

func (s *Service) operationTopologyDiagnostics(ctx context.Context, operationID string) []RunDetailDiagnostic {
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, operation_id, ifnull(parent_run_id, ''), ifnull(triggered_by_span_id, ''), ifnull(trace_id, '')
		FROM runs WHERE operation_id = ?
	`, operationID)
	if err != nil {
		return []RunDetailDiagnostic{{Code: "topology-query-failed", Severity: "warn", Message: "operation topology could not be fully inspected"}}
	}
	members := map[string]operationMemberTopology{}
	var runIDs []string
	for rows.Next() {
		var member operationMemberTopology
		if rows.Scan(&member.runID, &member.operationID, &member.parentRunID, &member.triggeredBySpanID, &member.traceID) != nil {
			continue
		}
		members[member.runID] = member
		runIDs = append(runIDs, member.runID)
	}
	_ = rows.Close()
	var diagnostics []RunDetailDiagnostic
	var rootPresent int
	_ = s.db.QueryRowContext(ctx, `SELECT root_present FROM operations WHERE operation_id = ?`, operationID).Scan(&rootPresent)
	if rootPresent == 0 {
		diagnostics = append(diagnostics, topologyDiagnostic("incomplete-operation-root", "operation root has not arrived"))
	}
	for _, runID := range runIDs {
		member := members[runID]
		if runID == operationID {
			if member.parentRunID != "" {
				diagnostics = append(diagnostics, topologyDiagnostic("root-has-parent", "operation root carries invalid parent topology"))
			}
			continue
		}
		if member.parentRunID == "" {
			diagnostics = append(diagnostics, topologyDiagnostic("missing-parent-run", "child run has no observed parent identity"))
			continue
		}
		if member.parentRunID == runID {
			diagnostics = append(diagnostics, topologyDiagnostic("self-parent-run", "child run references itself as parent"))
			continue
		}
		parent, exists := members[member.parentRunID]
		if !exists {
			var parentOperationID, parentTraceID string
			err := s.db.QueryRowContext(ctx, `SELECT operation_id, ifnull(trace_id, '') FROM runs WHERE run_id = ?`, member.parentRunID).Scan(&parentOperationID, &parentTraceID)
			if err == nil && parentOperationID != operationID {
				diagnostics = append(diagnostics, topologyDiagnostic("foreign-parent-run", "child run references a parent outside its operation"))
			} else {
				diagnostics = append(diagnostics, topologyDiagnostic("missing-parent-run", "child run parent has not arrived"))
			}
			continue
		}
		if parent.traceID != "" && member.traceID != "" && parent.traceID != member.traceID {
			diagnostics = append(diagnostics, topologyDiagnostic("parent-trace-conflict", "child and parent runs carry different trace identities"))
		}
		if member.triggeredBySpanID == "" {
			diagnostics = append(diagnostics, topologyDiagnostic("missing-trigger-span", "child run has no trigger span identity"))
		} else {
			var ownerRunID string
			if err := s.db.QueryRowContext(ctx, `SELECT run_id FROM spans WHERE span_id = ?`, member.triggeredBySpanID).Scan(&ownerRunID); err != nil || ownerRunID != member.parentRunID {
				diagnostics = append(diagnostics, topologyDiagnostic("missing-trigger-span", "child trigger span is unavailable from its parent run"))
			}
		}
	}
	if topologyHasCycle(operationID, members, runIDs) {
		diagnostics = append(diagnostics, topologyDiagnostic("parent-run-cycle", "operation contains a cycle in child-run topology"))
	}
	return diagnostics
}

func topologyDiagnostic(code, message string) RunDetailDiagnostic {
	return RunDetailDiagnostic{
		Code: code, Severity: "warn", Message: message,
		SuggestedFix: "Inspect immutable run:start operationId, parentRunId, triggeredBySpanId, and traceId fields.",
	}
}
