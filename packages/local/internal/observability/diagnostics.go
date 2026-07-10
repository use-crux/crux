package observability

import "time"

func runDetailDiagnostics(graph Graph) []RunDetailDiagnostic {
	return runDetailDiagnosticsAt(graph, time.Now())
}

func runDetailDiagnosticsAt(graph Graph, now time.Time) []RunDetailDiagnostic {
	diagnostics := runDiagnosticsAt(graph.Run, now)
	activityAt := graph.Run.lastActivityAt
	if graph.Run.TraceID != "" {
		for _, span := range graph.Spans {
			if span.TraceID != "" && span.TraceID != graph.Run.TraceID {
				diagnostics = append(diagnostics, RunDetailDiagnostic{
					Code:         "cross-trace-run",
					Severity:     "warn",
					Message:      "run contains spans with a different trace id",
					SpanIDs:      []string{span.SpanID},
					SuggestedFix: "Check propagation of runId/traceId through nested runtime boundaries so every span in a run keeps the root trace id.",
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
				Code:         "missing-parent-span",
				Severity:     "warn",
				Message:      "span references a parent that is not present in this run",
				SpanIDs:      []string{span.SpanID, span.ParentSpanID},
				SuggestedFix: "Ensure the parent span start/end records are emitted with the same run id before child spans are flushed.",
			})
		}
	}
	for _, span := range graph.Spans {
		diagnostics = append(diagnostics, spanStalenessDiagnosticsAt(span, activityAt, now)...)
	}
	return diagnostics
}

func runDiagnostics(run RunSummary) []RunDetailDiagnostic {
	return runDiagnosticsAt(run, time.Now())
}

func runDiagnosticsAt(run RunSummary, now time.Time) []RunDetailDiagnostic {
	// TraceAliasConflict is deterministic lookup/ambiguity metadata (see
	// ResolveRunIDs' newest-wins alias rule), not a lifecycle problem: multiple
	// logical runs legitimately share one trace id (e.g. nested flows), so it
	// must not surface as a diagnostic warning or suppress the checks below.
	if presentationReconciledFrom(run.Attributes) == "descendant.operation.deadline" {
		return []RunDetailDiagnostic{{
			Code:         "descendant-operation-deadline-exceeded",
			Severity:     "warn",
			Message:      "run has incomplete observability because a descendant exceeded its Crux operation deadline without a terminal record",
			SuggestedFix: "Flush or acknowledge terminal records from descendant operations before the Crux operation deadline expires.",
		}}
	}
	if (run.Status == "running" || run.Status == "incomplete") && run.EndedAt == "" && isStaleTimestampAt(staleTimestampAnchor(run.lastActivityAt, run.StartedAt), now) {
		return []RunDetailDiagnostic{{
			Code:         "stale-boundary",
			Severity:     "warn",
			Message:      "run has no end record and has been inactive past the local freshness window",
			SuggestedFix: "Close the observed run on every terminal path, including thrown errors, cancellations, and serverless boundary exits.",
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
			Code:         "operation-deadline-exceeded",
			Severity:     "warn",
			Message:      "span exceeded its Crux operation deadline before a terminal observability record arrived",
			SpanIDs:      []string{span.SpanID},
			SuggestedFix: "Close or error the observed span before the configured operation deadline, or extend the deadline for legitimate long-running work.",
		}}
	}
	if presentationReconciledFrom(span.Attributes) == "descendant.operation.deadline" {
		return []RunDetailDiagnostic{{
			Code:         "descendant-operation-deadline-exceeded",
			Severity:     "warn",
			Message:      "span has incomplete observability because a descendant exceeded its Crux operation deadline without a terminal record",
			SpanIDs:      []string{span.SpanID},
			SuggestedFix: "Check descendant operations for missing terminal span records or too-short operation deadlines.",
		}}
	}
	if presentationReconciledFrom(span.Attributes) == "runtime.convex.boundary.lease" {
		return []RunDetailDiagnostic{{
			Code:         "convex-boundary-lease-expired",
			Severity:     "warn",
			Message:      "Convex boundary did not send a terminal acknowledgement before its lease expired",
			SpanIDs:      []string{span.SpanID},
			SuggestedFix: "Ensure the Convex runtime bridge sends terminal acknowledgements or increases the boundary lease for this action.",
		}}
	}
	return spanStalenessDiagnosticsAt(span, "", now)
}

func spanStalenessDiagnosticsAt(span SpanSummary, activityAt string, now time.Time) []RunDetailDiagnostic {
	if (span.Status == "running" || span.Status == "stale") && span.EndedAt == "" && isStaleTimestampAt(staleTimestampAnchor(activityAt, span.StartedAt), now) {
		return []RunDetailDiagnostic{{
			Code:         "missing-span-end",
			Severity:     "warn",
			Message:      "span has no end record and appears stale",
			SpanIDs:      []string{span.SpanID},
			SuggestedFix: "Call span.end or span.error for this operation on every terminal path.",
		}}
	}
	return nil
}
