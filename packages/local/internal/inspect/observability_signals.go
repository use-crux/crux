package inspect

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func applyObservabilityRunSignals(run inspectRunRecord, signals observability.RunSignals) inspectRunRecord {
	run.ToolCallCount = signals.ToolCallCount
	run.DiagnosticCount = signals.DiagnosticCount
	run.DiagnosticMaxSeverity = signals.DiagnosticMaxSeverity
	run.DiagnosticCodes = appendUniqueStrings(run.DiagnosticCodes, signals.DiagnosticCodes...)
	run.ToolErrorCount = signals.ToolErrorCount
	run.RepeatedToolName = signals.RepeatedToolName
	run.RepeatedToolCount = signals.RepeatedToolCount
	run.RetrievalIssueCount = signals.RetrievalIssueCount
	run.InspectSignalIssueCount = signals.InspectSignalIssueCount
	run.SuspensionSignalCount = signals.SuspensionSignalCount
	run.BlockedSignalCount = signals.BlockedSignalCount
	return run
}

func enrichInspectRunWithObservabilitySignals(run inspectRunRecord, detail observability.RunDetail) inspectRunRecord {
	toolCounts := map[string]int{}
	addDiagnostics := func(diagnostics []observability.RunDetailDiagnostic) {
		for _, diagnostic := range diagnostics {
			run.DiagnosticCount++
			if diagnostic.Code != "" {
				run.DiagnosticCodes = appendUniqueString(run.DiagnosticCodes, diagnostic.Code)
			}
		}
	}

	addDiagnostics(detail.Diagnostics)
	for _, node := range flattenRunDetailNodes(detail.Root) {
		addDiagnostics(node.Diagnostics)
		for _, attached := range node.Details {
			addDiagnostics(attached.Diagnostics)
		}

		if isToolRunDetailNode(node) {
			toolName := firstNonEmpty(node.ToolName, stringMetric(jsonObject(node.Attributes), "toolName"), node.Name, node.SpanID)
			run.ToolCallCount++
			toolCounts[toolName]++
			if isAttentionStatus(node.Status) || len(node.Error) > 0 {
				run.ToolErrorCount++
			}
		}
		if isRetrievalRunDetailNode(node) && (isAttentionStatus(node.Status) || retrievalReturnedZero(node)) {
			run.RetrievalIssueCount++
		}
		if isInspectSignalRunDetailNode(node) && isAttentionStatus(node.Status) {
			run.InspectSignalIssueCount++
		}
		if node.Status == "blocked" {
			run.BlockedSignalCount++
		}
		if node.Status == "suspended" || node.Primitive == "flow.suspension" {
			run.SuspensionSignalCount++
		}
	}

	for toolName, count := range toolCounts {
		if count > run.RepeatedToolCount {
			run.RepeatedToolName = toolName
			run.RepeatedToolCount = count
		}
	}
	return run
}

func isToolRunDetailNode(node observability.RunDetailNode) bool {
	return node.Family == "tool" || node.Primitive == "tool.call" || node.ToolName != ""
}

func isRetrievalRunDetailNode(node observability.RunDetailNode) bool {
	return node.Family == "retrieval" || strings.HasPrefix(node.Primitive, "retrieval.")
}

func isInspectSignalRunDetailNode(node observability.RunDetailNode) bool {
	switch node.Family {
	case "guardrail", "constraint", "scoring", "citation":
		return true
	}
	return strings.HasPrefix(node.Primitive, "guardrail.") ||
		strings.HasPrefix(node.Primitive, "constraint.") ||
		strings.HasPrefix(node.Primitive, "scoring.") ||
		strings.HasPrefix(node.Primitive, "citation.")
}

func isAttentionStatus(status string) bool {
	switch normalizeStatus(status) {
	case "error", "fail", "failed", "blocked", "incomplete", "stale":
		return true
	default:
		return false
	}
}

func retrievalReturnedZero(node observability.RunDetailNode) bool {
	if count, ok := numericAnyMetric(jsonObject(node.Attributes), "resultCount", "results", "hitCount", "hits", "count", "returned"); ok && count == 0 {
		return true
	}
	for _, artifact := range node.Artifacts {
		if artifact.Kind != "retrieval.hits" {
			continue
		}
		preview := jsonObject(artifact.Preview)
		if count, ok := numericAnyMetric(preview, "resultCount", "results", "hitCount", "hits", "count", "returned"); ok && count == 0 {
			return true
		}
		if hits, ok := preview["hits"].([]any); ok && len(hits) == 0 {
			return true
		}
	}
	return false
}

func numericAnyMetric(values map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int(typed), true
		case int:
			return typed, true
		case []any:
			return len(typed), true
		}
	}
	return 0, false
}

func toolCallCountFromObservabilityRunDetail(detail observability.RunDetail) int {
	count := 0
	for _, node := range flattenRunDetailNodes(detail.Root) {
		if node.Family == "tool" || node.Primitive == "tool.call" || node.ToolName != "" {
			count++
		}
	}
	return count
}
