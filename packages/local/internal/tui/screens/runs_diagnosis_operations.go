package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func diagnosisCriticalPath(root api.ObservabilityRunDetailNode, timeline []RunRow) []RunRow {
	if diagnosisNodeID(root.SpanID, root.ID) == "" || diagnosisDuration(root) <= 0 {
		return nil
	}
	rows := make(map[string]RunRow, len(timeline))
	for _, row := range timeline {
		rows[row.ID] = row
	}
	path := make([]RunRow, 0)
	current := root
	for {
		if row, exists := rows[diagnosisNodeID(current.SpanID, current.ID)]; exists {
			path = append(path, row)
		}
		if len(current.Children) == 0 {
			break
		}
		next := -1
		for index := range current.Children {
			if diagnosisDuration(current.Children[index]) > 0 && (next == -1 || diagnosisDuration(current.Children[index]) > diagnosisDuration(current.Children[next])) {
				next = index
			}
		}
		if next == -1 {
			break
		}
		current = current.Children[next]
	}
	return path
}

func diagnosisDuration(node api.ObservabilityRunDetailNode) float64 {
	return firstPositive(node.Timing.DurationMs, node.DurationMs)
}

func diagnosisOperations(diagnosis RunDiagnosis, root api.ObservabilityRunDetailNode) []OperationDiagnosis {
	operations := make([]OperationDiagnosis, 0)
	seen := make(map[string]bool)
	appendOperation := func(operation OperationDiagnosis) {
		key := operation.NodeID + "\x00" + operation.Evidence
		if operation.NodeID == "" || seen[key] {
			return
		}
		seen[key] = true
		operations = append(operations, operation)
	}
	appendActivity := func(nodeID, name, primitive, status string) {
		if isAbnormalOperationStatus(status) {
			appendOperation(OperationDiagnosis{
				NodeID: nodeID, Name: name, Status: status, Evidence: status + " status",
			})
		}
		if strings.Contains(strings.ToLower(primitive), "retry") {
			appendOperation(OperationDiagnosis{
				NodeID: nodeID, Name: name, Status: status, Evidence: "retry activity",
			})
		}
	}
	for _, row := range diagnosis.Timeline {
		status := firstNonEmpty(row.Activity.Status, row.Span.Status)
		appendActivity(row.ID, row.Span.Name, firstNonEmpty(row.Activity.Primitive, row.Span.Op), status)
	}
	var appendDetails func(api.ObservabilityRunDetailNode)
	appendDetails = func(node api.ObservabilityRunDetailNode) {
		for _, detail := range node.Details {
			appendActivity(
				diagnosisNodeID(detail.SpanID, detail.ID),
				firstNonEmpty(detail.Name, detail.Label, detail.Display, detail.ID),
				detail.Primitive,
				detail.Status,
			)
		}
		for _, child := range node.Children {
			appendDetails(child)
		}
	}
	appendDetails(root)
	for _, item := range diagnosis.Events {
		if strings.Contains(strings.ToLower(item.Event.Name), "retry") {
			appendOperation(OperationDiagnosis{NodeID: item.NodeID, Name: diagnosisActivityName(diagnosis.Timeline, item.NodeID), Evidence: "retry event: " + item.Event.Name})
		}
	}
	return operations
}

func isAbnormalOperationStatus(status string) bool {
	switch strings.ToLower(status) {
	case "failed", "fail", "error", "blocked", "suspended", "cancelled", "canceled", "stale", "incomplete":
		return true
	default:
		return false
	}
}

func diagnosisActivityName(rows []RunRow, nodeID string) string {
	for _, row := range rows {
		if row.ID == nodeID {
			return row.Span.Name
		}
	}
	return nodeID
}
