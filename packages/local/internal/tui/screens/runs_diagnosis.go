package screens

import (
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

// RunDiagnosis is the deterministic, diagnosis-oriented projection rendered by
// Runs. Raw retains the complete source record for explicit inspection and
// export; renderers use the semantic fields by default.
type RunDiagnosis struct {
	Summary        DiagnosisSummary
	CriticalPath   []RunRow
	Timeline       []RunRow
	Operations     []OperationDiagnosis
	Failures       []FailureItem
	Diagnostics    []DiagnosisItem
	DefinitionRefs []observability.DefinitionRef
	Artifacts      []ArtifactItem
	Events         []EventItem
	Raw            api.ObservabilityRunDetail
}

// DiagnosisSummary contains the stable run identity and top-level timing users
// need before inspecting individual activity.
type DiagnosisSummary struct {
	RunID      string
	Name       string
	Status     string
	StartedAt  string
	EndedAt    string
	DurationMs float64
	Model      string
	Provider   string
	SpanCount  int
	Failure    string
}

// DiagnosisItem associates one backend diagnostic with the activity that
// supplied it. An empty NodeID denotes run-level evidence.
type DiagnosisItem struct {
	NodeID     string
	Diagnostic observability.RunDetailDiagnostic
}

// OperationDiagnosis identifies an activity that needs attention using only
// explicit status, diagnostic, or retry evidence from the run detail.
type OperationDiagnosis struct {
	NodeID   string
	Name     string
	Status   string
	Evidence string
}

// FailureItem associates bounded failure text with the activity that emitted
// it. An empty NodeID denotes run-level evidence.
type FailureItem struct {
	NodeID  string
	Message string
}

// ArtifactItem associates an artifact with the activity that produced it.
type ArtifactItem struct {
	NodeID   string
	Artifact observability.ArtifactSummary
}

// EventItem associates an event with the activity that emitted it.
type EventItem struct {
	NodeID string
	Event  observability.SpanEventSummary
}

// DiagnoseRun projects a complete observability detail into stable semantic
// sections without terminal state, I/O, or mutation.
func DiagnoseRun(detail api.ObservabilityRunDetail) RunDiagnosis {
	failure := ""
	if hasJSONValue(detail.Run.Error) {
		failure = boundedDiagnosisText(errorPreview(detail.Run.Error, diagnosisTextLimit), diagnosisTextLimit)
	}
	diagnosis := RunDiagnosis{
		Summary: DiagnosisSummary{
			RunID:      detail.Run.RunID,
			Name:       detail.Run.Name,
			Status:     detail.Run.Status,
			StartedAt:  detail.Run.StartedAt,
			EndedAt:    detail.Run.EndedAt,
			DurationMs: detail.Run.DurationMs,
			Model:      detail.Run.Model,
			Provider:   detail.Run.Provider,
			SpanCount:  detail.Run.SpanCount,
			Failure:    failure,
		},
		Raw: detail,
	}
	if failure != "" {
		diagnosis.Failures = append(diagnosis.Failures, FailureItem{Message: failure})
	}
	projectDiagnosisNode(&diagnosis, detail.Root)
	diagnosis.Timeline = diagnosisTimeline(detail.Root)
	diagnosis.CriticalPath = diagnosisCriticalPath(detail.Root, diagnosis.Timeline)
	diagnosis.Diagnostics = diagnosisItems(detail)
	diagnosis.DefinitionRefs = diagnosisDefinitionRefs(detail)
	diagnosis.Operations = diagnosisOperations(diagnosis, detail.Root)
	return diagnosis
}

func diagnosisTimeline(root api.ObservabilityRunDetailNode) []RunRow {
	if firstNonEmpty(root.SpanID, root.ID) == "" {
		return nil
	}
	spans := inspectSpansFromRunDetailNode(root)
	depths := runSpanDepths(spans)
	rows := make([]RunRow, len(spans))
	for index, span := range spans {
		rows[index] = runRow(span, depths[span.ID], "", false)
	}
	activities := make(map[string]api.ObservabilityRunDetailNode)
	collectDiagnosisActivities(activities, root)
	for index := range rows {
		rows[index].Activity = activities[rows[index].ID]
	}
	return rows
}

func collectDiagnosisActivities(
	activities map[string]api.ObservabilityRunDetailNode,
	node api.ObservabilityRunDetailNode,
) {
	id := firstNonEmpty(node.SpanID, node.ID)
	activities[id] = node
	for _, child := range node.Children {
		collectDiagnosisActivities(activities, child)
	}
}

func projectDiagnosisNode(diagnosis *RunDiagnosis, node api.ObservabilityRunDetailNode) {
	nodeID := diagnosisNodeID(node.SpanID, node.ID)
	virtualRunDuplicate := node.Virtual && sameJSON(node.Error, diagnosis.Raw.Run.Error)
	if !virtualRunDuplicate {
		diagnosis.Failures = appendFailureItem(diagnosis.Failures, nodeID, node.Error)
	}
	diagnosis.Artifacts = appendArtifactItems(diagnosis.Artifacts, nodeID, node.Artifacts)
	diagnosis.Events = appendEventItems(diagnosis.Events, nodeID, node.Events)
	for _, detail := range node.Details {
		detailID := diagnosisNodeID(detail.SpanID, detail.ID)
		diagnosis.Failures = appendFailureItem(diagnosis.Failures, detailID, detail.Error)
		diagnosis.Artifacts = appendArtifactItems(diagnosis.Artifacts, detailID, detail.Artifacts)
		diagnosis.Events = appendEventItems(diagnosis.Events, detailID, detail.Events)
	}
	for _, child := range node.Children {
		projectDiagnosisNode(diagnosis, child)
	}
}

func appendArtifactItems(
	items []ArtifactItem,
	nodeID string,
	artifacts []observability.ArtifactSummary,
) []ArtifactItem {
	for _, artifact := range artifacts {
		items = append(items, ArtifactItem{NodeID: nodeID, Artifact: artifact})
	}
	return items
}

func appendEventItems(
	items []EventItem,
	nodeID string,
	events []observability.SpanEventSummary,
) []EventItem {
	for _, event := range events {
		items = append(items, EventItem{NodeID: nodeID, Event: event})
	}
	return items
}

func (s *Runs) allTimelineRows() []RunRow {
	if s.diagnosis != nil {
		return s.diagnosis.Timeline
	}
	return nil
}

func (s *Runs) runStartedAtMillis() int64 {
	if s.diagnosis != nil {
		return parseObservabilityTime(s.diagnosis.Summary.StartedAt)
	}
	return 0
}

func (s *Runs) runDurationPointer() *float64 {
	if s.diagnosis != nil {
		duration := s.diagnosis.Summary.DurationMs
		return &duration
	}
	return nil
}
