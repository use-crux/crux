package observability

import "time"

func runDetailDiagnostics(graph Graph) []RunDetailDiagnostic {
	return runDetailDiagnosticsAt(graph, time.Now())
}

func runDetailDiagnosticsAt(graph Graph, now time.Time) []RunDetailDiagnostic {
	diagnostics := runDiagnosticsAt(graph.Run, now)
	if graph.Run.TraceID != "" {
		for _, span := range graph.Spans {
			if span.TraceID != "" && span.TraceID != graph.Run.TraceID {
				diagnostics = append(diagnostics, RunDetailDiagnostic{
					Code:     "cross-trace-run",
					Severity: "warn",
					Message:  "run contains spans with a different trace id",
					SpanIDs:  []string{span.SpanID},
				})
				break
			}
		}
	}
	spanIDs := make(map[string]struct{}, len(graph.Spans))
	for _, span := range graph.Spans {
		spanIDs[span.SpanID] = struct{}{}
	}
	for _, span := range graph.Spans {
		if span.ParentSpanID == "" {
			continue
		}
		if _, ok := spanIDs[span.ParentSpanID]; !ok {
			diagnostics = append(diagnostics, RunDetailDiagnostic{
				Code:     "missing-parent-span",
				Severity: "warn",
				Message:  "span references a parent that is not present in this run",
				SpanIDs:  []string{span.SpanID, span.ParentSpanID},
			})
		}
	}
	return diagnostics
}

func runDiagnostics(run RunSummary) []RunDetailDiagnostic {
	return runDiagnosticsAt(run, time.Now())
}

func runDiagnosticsAt(run RunSummary, now time.Time) []RunDetailDiagnostic {
	if presentationReconciledFrom(run.Attributes) == "descendant.operation.deadline" {
		return []RunDetailDiagnostic{{
			Code:     "descendant-operation-deadline-exceeded",
			Severity: "warn",
			Message:  "run has incomplete observability because a descendant exceeded its Crux operation deadline without a terminal record",
		}}
	}
	if (run.Status == "running" || run.Status == "stale") && run.EndedAt == "" && isStaleTimestampAt(run.StartedAt, now) {
		return []RunDetailDiagnostic{{
			Code:     "stale-boundary",
			Severity: "warn",
			Message:  "run has no end record and has been inactive past the local freshness window",
		}}
	}
	return nil
}

func spanDiagnostics(span SpanSummary) []RunDetailDiagnostic {
	return spanDiagnosticsAt(span, time.Now())
}

func spanDiagnosticsAt(span SpanSummary, now time.Time) []RunDetailDiagnostic {
	if presentationReconciledFrom(span.Attributes) == "operation.deadline" {
		return []RunDetailDiagnostic{{
			Code:     "operation-deadline-exceeded",
			Severity: "warn",
			Message:  "span exceeded its Crux operation deadline before a terminal observability record arrived",
			SpanIDs:  []string{span.SpanID},
		}}
	}
	if presentationReconciledFrom(span.Attributes) == "descendant.operation.deadline" {
		return []RunDetailDiagnostic{{
			Code:     "descendant-operation-deadline-exceeded",
			Severity: "warn",
			Message:  "span has incomplete observability because a descendant exceeded its Crux operation deadline without a terminal record",
			SpanIDs:  []string{span.SpanID},
		}}
	}
	if presentationReconciledFrom(span.Attributes) == "runtime.convex.boundary.lease" {
		return []RunDetailDiagnostic{{
			Code:     "convex-boundary-lease-expired",
			Severity: "warn",
			Message:  "Convex boundary did not send a terminal acknowledgement before its lease expired",
			SpanIDs:  []string{span.SpanID},
		}}
	}
	if (span.Status == "running" || span.Status == "stale") && span.EndedAt == "" && isStaleTimestampAt(span.StartedAt, now) {
		return []RunDetailDiagnostic{{
			Code:     "missing-span-end",
			Severity: "warn",
			Message:  "span has no end record and appears stale",
			SpanIDs:  []string{span.SpanID},
		}}
	}
	return nil
}
