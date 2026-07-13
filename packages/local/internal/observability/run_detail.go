package observability

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func buildRunDetailRoot(
	presentation presentation,
	graph Graph,
	eventsBySpan map[string][]SpanEventSummary,
	artifactsBySpan map[string][]ArtifactSummary,
	edgesBySpan map[string][]EdgeSummary,
	canonicalParents map[string]string,
	spanIndex map[string]RunDetailPlacement,
	now time.Time,
) RunDetailNode {
	children := make([]RunDetailNode, 0, len(presentation.Spans))
	for _, child := range presentation.Spans {
		children = append(children, runDetailNodeFromPresentation(child, "run:"+graph.Run.RunID, []string{"run:" + graph.Run.RunID}, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, now))
	}

	if len(children) == 1 && rootMatchesRun(graph.Run, children[0].SpanSummary) {
		root := children[0]
		root.Status = graph.Run.Status
		root.ID = "run:" + graph.Run.RunID
		root.ParentID = ""
		root.Path = []string{root.ID}
		root.Display.Label = firstNonEmpty(graph.Run.Name, root.Display.Label)
		for _, detail := range presentation.RunDetails {
			root.Details = append(root.Details, runDetailDetailFromPresentation(detail, root.ID, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, now))
		}
		root.Children = reparentRunDetailChildren(root.Children, root.ID, root.Path, spanIndex)
		root.Timing.DetailsMs = sumDetailDuration(root.Details)
		spanIndex[root.SpanID] = RunDetailPlacement{Placement: "node", NodeID: root.ID, Path: root.Path, Reason: "run-root"}
		return root
	}

	root := virtualRunDetailRootAt(graph.Run, now)
	for _, detail := range presentation.RunDetails {
		root.Details = append(root.Details, runDetailDetailFromPresentation(detail, root.ID, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, now))
	}
	root.Children = children
	for i := range root.Children {
		root.Children[i].ParentID = root.ID
		root.Children[i].Path = append([]string{root.ID}, root.Children[i].ID)
		updateRunDetailPaths(&root.Children[i], spanIndex)
	}
	root.Timing.DetailsMs = sumDetailDuration(root.Details)
	return root
}

func runDetailNodeFromPresentation(
	node presentationNode,
	parentID string,
	parentPath []string,
	eventsBySpan map[string][]SpanEventSummary,
	artifactsBySpan map[string][]ArtifactSummary,
	edgesBySpan map[string][]EdgeSummary,
	canonicalParents map[string]string,
	spanIndex map[string]RunDetailPlacement,
	now time.Time,
) RunDetailNode {
	id := "span:" + node.SpanID
	path := append(append([]string(nil), parentPath...), id)
	detailNode := RunDetailNode{
		SpanSummary:   node.SpanSummary,
		ID:            id,
		Virtual:       false,
		ParentID:      parentID,
		Path:          path,
		Kind:          runDetailKind(node.Family, node.Primitive),
		Display:       runDetailDisplay(node.SpanSummary),
		Timing:        runDetailTiming(node.SpanSummary),
		MetricBuckets: RunDetailMetricBuckets{Own: emptyRawAsNil(node.Metrics), Total: emptyRawAsNil(node.Metrics)},
		Source: RunDetailSource{
			PlacementReason:       "primary",
			CanonicalParentSpanID: canonicalParents[node.SpanID],
		},
		Details:     make([]RunDetailDetail, 0, len(node.Details)),
		Artifacts:   artifactsBySpan[node.SpanID],
		Events:      eventsBySpan[node.SpanID],
		Relations:   edgesBySpan[node.SpanID],
		Diagnostics: spanDiagnosticsAt(node.SpanSummary, now),
		Children:    make([]RunDetailNode, 0, len(node.Children)),
	}
	for _, detail := range node.Details {
		detailNode.Details = append(detailNode.Details, runDetailDetailFromPresentation(detail, detailNode.ID, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, now))
	}
	for _, child := range node.Children {
		detailNode.Children = append(detailNode.Children, runDetailNodeFromPresentation(child, detailNode.ID, path, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, now))
	}
	detailNode.Timing.ChildrenMs = sumChildDuration(detailNode.Children)
	detailNode.Timing.DetailsMs = sumDetailDuration(detailNode.Details)
	detailNode.Timing.SelfMs = maxFloat(0, detailNode.DurationMs-detailNode.Timing.ChildrenMs)
	spanIndex[node.SpanID] = RunDetailPlacement{Placement: "node", NodeID: id, Path: path, Reason: "primary"}
	return detailNode
}

func runDetailDetailFromPresentation(
	detail presentationDetail,
	ownerNodeID string,
	eventsBySpan map[string][]SpanEventSummary,
	artifactsBySpan map[string][]ArtifactSummary,
	edgesBySpan map[string][]EdgeSummary,
	canonicalParents map[string]string,
	spanIndex map[string]RunDetailPlacement,
	now time.Time,
) RunDetailDetail {
	placementReason := detailPlacementReason(detail.SpanSummary)
	spanIndex[detail.SpanID] = RunDetailPlacement{
		Placement:   "detail",
		OwnerNodeID: ownerNodeID,
		Path:        []string{ownerNodeID, "detail:" + detail.SpanID},
		Reason:      placementReason,
	}
	return RunDetailDetail{
		SpanSummary: detail.SpanSummary,
		ID:          "detail:" + detail.SpanID,
		Kind:        runDetailKind(detail.Family, detail.Primitive),
		Role:        detailRole(detail.SpanSummary),
		Label:       runDetailDisplay(detail.SpanSummary).Label,
		Display:     detail.Display,
		Timing:      runDetailTiming(detail.SpanSummary),
		Events:      eventsBySpan[detail.SpanID],
		Artifacts:   artifactsBySpan[detail.SpanID],
		Relations:   edgesBySpan[detail.SpanID],
		Diagnostics: spanDiagnosticsAt(detail.SpanSummary, now),
		Source: RunDetailSource{
			PlacementReason:       placementReason,
			OwnerSpanID:           ownerSpanIDFromNodeID(ownerNodeID),
			CanonicalParentSpanID: canonicalParents[detail.SpanID],
		},
	}
}

type detailOwner struct {
	spanID string
	reason string
}

func applySemanticDetailOwnership(root *RunDetailNode, graph Graph, spanIndex map[string]RunDetailPlacement) {
	owners := detailOwners(graph)
	if len(owners) == 0 {
		resetRunDetailIndex(root, spanIndex)
		return
	}

	nodesBySpan := make(map[string]*RunDetailNode)
	indexRunDetailNodes(root, nodesBySpan)
	moveOwnedDetails(root, nodesBySpan, owners)
	resetRunDetailIndex(root, spanIndex)
}

func detailOwners(graph Graph) map[string]detailOwner {
	owners := make(map[string]detailOwner)
	for _, span := range graph.Spans {
		if ownerSpanID := presentationOwnerOverride(span.Attributes); ownerSpanID != "" {
			owners[span.SpanID] = detailOwner{spanID: ownerSpanID, reason: "owner-hint"}
		}
	}
	for _, edge := range graph.Edges {
		if edge.EdgeType != "explains" || edge.From.Kind != "span" || edge.To.Kind != "span" {
			continue
		}
		owners[edge.From.ID] = detailOwner{spanID: edge.To.ID, reason: "explains-edge"}
	}
	return owners
}

func indexRunDetailNodes(node *RunDetailNode, nodesBySpan map[string]*RunDetailNode) {
	if node.SpanID != "" {
		nodesBySpan[node.SpanID] = node
	}
	for i := range node.Children {
		indexRunDetailNodes(&node.Children[i], nodesBySpan)
	}
}

func moveOwnedDetails(node *RunDetailNode, nodesBySpan map[string]*RunDetailNode, owners map[string]detailOwner) {
	retained := node.Details[:0]
	for _, detail := range node.Details {
		owner, hasOwner := owners[detail.SpanID]
		target, hasTarget := nodesBySpan[owner.spanID]
		if !hasOwner || !hasTarget {
			retained = append(retained, detail)
			continue
		}
		if target.ID == node.ID {
			detail.Source.PlacementReason = owner.reason
			detail.Source.OwnerSpanID = owner.spanID
			retained = append(retained, detail)
			continue
		}
		detail.Source.PlacementReason = owner.reason
		detail.Source.OwnerSpanID = owner.spanID
		target.Details = append(target.Details, detail)
	}
	node.Details = retained
	node.Timing.DetailsMs = sumDetailDuration(node.Details)

	for i := range node.Children {
		moveOwnedDetails(&node.Children[i], nodesBySpan, owners)
	}
}

func applyRunDetailRollups(node *RunDetailNode) map[string]float64 {
	own := runDetailOwnMetrics(node.SpanSummary, node.Events, node.Artifacts)
	details := make(map[string]float64)
	for _, detail := range node.Details {
		addMetrics(details, runDetailDetailOwnMetrics(detail))
	}
	children := make(map[string]float64)
	for i := range node.Children {
		addMetrics(children, applyRunDetailRollups(&node.Children[i]))
	}
	total := copyMetrics(own)
	if node.Virtual && node.Kind == "run" {
		total = copyMetrics(children)
		addMetrics(total, details)
		mergeMissingOrZeroMetrics(total, own)
	} else {
		addMetrics(total, details)
		addMetrics(total, children)
	}
	node.MetricBuckets = RunDetailMetricBuckets{
		Own:      metricsRawOrNil(own),
		Children: metricsRawOrNil(children),
		Details:  metricsRawOrNil(details),
		Total:    metricsRawOrNil(total),
	}
	node.Timing.ChildrenMs = sumChildDuration(node.Children)
	node.Timing.DetailsMs = sumDetailDuration(node.Details)
	node.Timing.SelfMs = maxFloat(0, node.DurationMs-node.Timing.ChildrenMs)
	return total
}

func runDetailOwnMetrics(span SpanSummary, events []SpanEventSummary, artifacts []ArtifactSummary) map[string]float64 {
	own := metricsFromRaw(span.Metrics)
	eventMetrics := metricsFromUsageEvents(events)
	mergeMissingOrZeroMetrics(own, eventMetrics)
	artifactMetrics := metricsFromArtifacts(artifacts)
	mergeMissingOrZeroMetrics(own, artifactMetrics)
	normalizeUsageTotals(own)
	return own
}

func runDetailDetailOwnMetrics(detail RunDetailDetail) map[string]float64 {
	return runDetailOwnMetrics(detail.SpanSummary, detail.Events, detail.Artifacts)
}

func metricsFromUsageEvents(events []SpanEventSummary) map[string]float64 {
	metrics := map[string]float64{}
	for _, event := range events {
		if event.Name != "usage.observed" {
			continue
		}
		addMetrics(metrics, metricsFromRaw(event.Attributes))
	}
	normalizeUsageTotals(metrics)
	return metrics
}

func metricsFromArtifacts(artifacts []ArtifactSummary) map[string]float64 {
	metrics := map[string]float64{}
	for _, artifact := range artifacts {
		mergeMissingOrZeroMetrics(metrics, metricsFromArtifact(artifact))
	}
	normalizeUsageTotals(metrics)
	return metrics
}

func metricsFromArtifact(artifact ArtifactSummary) map[string]float64 {
	metrics := map[string]float64{}
	for _, raw := range []json.RawMessage{
		jsonObjectAtPath(artifact.Preview, "usage"),
		jsonObjectAtPath(artifact.Preview, "metrics"),
		jsonObjectAtPath(artifact.Preview, "streaming"),
		jsonObjectAtPath(artifact.Preview, "meta", "usage"),
		jsonObjectAtPath(artifact.Preview, "meta", "metrics"),
		jsonObjectAtPath(artifact.Preview, "meta", "streaming"),
	} {
		mergeMissingOrZeroMetrics(metrics, metricsFromRaw(raw))
	}
	mergeMissingOrZeroMetrics(metrics, scalarMetricsFromRaw(artifact.Preview, "costUsd", "cost", "totalCost", "ttftMs", "tokensPerSecond"))
	mergeMissingOrZeroMetrics(metrics, scalarMetricsFromRaw(jsonObjectAtPath(artifact.Preview, "meta"), "costUsd", "cost", "totalCost", "ttftMs", "tokensPerSecond"))
	normalizeUsageTotals(metrics)
	return metrics
}

func metricsFromRaw(raw json.RawMessage) map[string]float64 {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]float64{}
	}
	var decoded map[string]float64
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return map[string]float64{}
	}
	out := canonicalMetricMap(decoded, true)
	normalizeUsageTotals(out)
	return out
}

func numericMetricsFromRaw(raw json.RawMessage) map[string]float64 {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]float64{}
	}
	var decoded map[string]float64
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return map[string]float64{}
	}
	out := canonicalMetricMap(decoded, false)
	normalizeUsageTotals(out)
	return out
}

func isAdditiveMetric(key string) bool {
	normalized := strings.ToLower(key)
	if normalized == "score" || strings.HasSuffix(normalized, "score") || strings.Contains(normalized, "confidence") {
		return false
	}
	return true
}

type metricAliasGroup struct {
	canonical string
	aliases   []string
}

var metricAliasGroups = []metricAliasGroup{
	{canonical: "costUsd", aliases: []string{"cost", "totalCost"}},
	{canonical: "cacheReadTokens", aliases: []string{"cachedInputTokens"}},
}

func canonicalMetricMap(decoded map[string]float64, additiveOnly bool) map[string]float64 {
	out := make(map[string]float64, len(decoded))
	reserved := map[string]struct{}{}
	for _, group := range metricAliasGroups {
		reserved[group.canonical] = struct{}{}
		for _, alias := range group.aliases {
			reserved[alias] = struct{}{}
		}
		if value, ok := firstMetricValue(decoded, append([]string{group.canonical}, group.aliases...)); ok {
			if !additiveOnly || isAdditiveMetric(group.canonical) {
				addMetric(out, group.canonical, value)
			}
		}
	}
	for key, value := range decoded {
		if _, isReserved := reserved[key]; isReserved {
			continue
		}
		if additiveOnly && !isAdditiveMetric(key) {
			continue
		}
		addMetric(out, key, value)
	}
	return out
}

func firstMetricValue(metrics map[string]float64, keys []string) (float64, bool) {
	for _, key := range keys {
		value, ok := metrics[key]
		if ok {
			return value, true
		}
	}
	return 0, false
}

func copyMetrics(values map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func addMetrics(target map[string]float64, source map[string]float64) {
	for key, value := range source {
		addMetric(target, key, value)
	}
	normalizeUsageTotals(target)
}

func addMetric(target map[string]float64, key string, value float64) {
	switch key {
	case "ttftMs":
		current, exists := target[key]
		if !exists || current == 0 || (value > 0 && value < current) {
			target[key] = value
		}
	case "tokensPerSecond":
		current, exists := target[key]
		if !exists || current == 0 {
			target[key] = value
		}
	default:
		target[key] += value
	}
}

func mergeMissingOrZeroMetrics(target map[string]float64, source map[string]float64) {
	normalizeUsageTotals(target)
	normalizeUsageTotals(source)
	for key, value := range source {
		current, exists := target[key]
		if exists && current != 0 {
			continue
		}
		if value == 0 && exists {
			continue
		}
		target[key] = value
	}
	normalizeUsageTotals(target)
}

func normalizeUsageTotals(metrics map[string]float64) {
	if len(metrics) == 0 {
		return
	}
	canonicalizeMetricsInPlace(metrics)
	total := metrics["inputTokens"] + metrics["outputTokens"]
	if total > 0 {
		if existing, ok := metrics["totalTokens"]; !ok || existing < total {
			metrics["totalTokens"] = total
		}
	}
}

func canonicalizeMetricsInPlace(metrics map[string]float64) {
	canonical := canonicalMetricMap(metrics, false)
	for key := range metrics {
		delete(metrics, key)
	}
	for key, value := range canonical {
		metrics[key] = value
	}
}

func metricsRawOrNil(values map[string]float64) json.RawMessage {
	if len(values) == 0 {
		return nil
	}
	normalizeUsageTotals(values)
	raw, err := json.Marshal(values)
	if err != nil {
		return nil
	}
	return raw
}

func jsonObjectAtPath(raw json.RawMessage, path ...string) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	current := raw
	for _, key := range path {
		var object map[string]json.RawMessage
		if err := json.Unmarshal(current, &object); err != nil {
			return nil
		}
		next, ok := object[key]
		if !ok {
			return nil
		}
		current = next
	}
	return current
}

func scalarMetricsFromRaw(raw json.RawMessage, keys ...string) map[string]float64 {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]float64{}
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return map[string]float64{}
	}
	decoded := map[string]float64{}
	for _, key := range keys {
		valueRaw, ok := object[key]
		if !ok {
			continue
		}
		var value float64
		if err := json.Unmarshal(valueRaw, &value); err != nil {
			continue
		}
		decoded[key] = value
	}
	return metricsFromNumericMap(decoded)
}

func metricsFromNumericMap(decoded map[string]float64) map[string]float64 {
	out := canonicalMetricMap(decoded, true)
	normalizeUsageTotals(out)
	return out
}

func applyRunDetailStatusRollups(node *RunDetailNode) string {
	status := node.Status
	for i := range node.Children {
		status = higherPrecedenceStatus(status, applyRunDetailStatusRollups(&node.Children[i]))
	}
	if node.Primitive == "flow.suspension" && node.Status == "suspended" {
		status = higherPrecedenceStatus(status, "suspended")
	}
	node.Status = status
	node.Display.Severity = severityForStatus(status)
	return status
}

func higherPrecedenceStatus(a, b string) string {
	if statusPrecedence(b) < statusPrecedence(a) {
		return b
	}
	return a
}

func statusPrecedence(status string) int {
	switch status {
	case "error":
		return 0
	case "blocked":
		return 1
	case "suspended":
		return 2
	case "cancelled":
		return 3
	case "stale":
		return 4
	case "incomplete":
		return 5
	case "running":
		return 6
	case "ok", "success", "skipped":
		return 7
	default:
		return 8
	}
}

func applyRunDetailInspection(node *RunDetailNode, toolRequestsByCallID map[string][]ArtifactSummary) {
	for i := range node.Children {
		applyRunDetailInspection(&node.Children[i], toolRequestsByCallID)
	}
	node.Inspection = buildInspection(node.SpanSummary, node.Events, node.Artifacts, node.Relations, node.Diagnostics, node.Details, toolRequestsByCallID)
	for i := range node.Details {
		detail := &node.Details[i]
		detail.Inspection = buildInspection(detail.SpanSummary, detail.Events, detail.Artifacts, detail.Relations, detail.Diagnostics, nil, toolRequestsByCallID)
	}
}

func buildToolRequestIndex(artifacts []ArtifactSummary) map[string][]ArtifactSummary {
	index := make(map[string][]ArtifactSummary)
	for _, artifact := range artifacts {
		if artifact.Kind != "tool.request" {
			continue
		}
		toolCallID := toolCallIDFromArtifact(artifact)
		if toolCallID == "" {
			continue
		}
		index[toolCallID] = append(index[toolCallID], artifact)
	}
	return index
}

func buildInspection(
	span SpanSummary,
	events []SpanEventSummary,
	artifacts []ArtifactSummary,
	relations []EdgeSummary,
	diagnostics []RunDetailDiagnostic,
	details []RunDetailDetail,
	toolRequestsByCallID map[string][]ArtifactSummary,
) RunDetailInspection {
	sections := RunDetailInspection{}
	if span.Primitive == "tool.call" {
		toolCallID := toolCallIDFromSpan(span)
		if toolCallID != "" {
			artifacts = appendMissingArtifacts(artifacts, toolRequestsByCallID[toolCallID]...)
		}
	}
	if hasJSONValue(span.Error) {
		sections["errors"] = append(sections["errors"], RunDetailInspectionItem{
			Type:         "span.error",
			ID:           "error:" + firstNonEmpty(span.SpanID, span.RunID),
			Label:        "Span error",
			Kind:         span.Primitive,
			SourceSpanID: span.SpanID,
			Data:         span.Error,
		})
	}
	for _, artifact := range artifacts {
		section := inspectionSectionForArtifact(artifact.Kind)
		label, data := inspectionArtifactItem(artifact)
		sections[section] = append(sections[section], RunDetailInspectionItem{
			Type:         "artifact",
			ID:           artifact.ArtifactID,
			Label:        label,
			Kind:         artifact.Kind,
			SourceSpanID: artifact.SpanID,
			Data:         data,
		})
	}
	for _, event := range events {
		sections["events"] = append(sections["events"], RunDetailInspectionItem{
			Type:         "event",
			ID:           event.EventID,
			Label:        event.Name,
			Kind:         event.Name,
			SourceSpanID: event.SpanID,
			Data:         event.Attributes,
		})
	}
	for _, relation := range relations {
		sections["relations"] = append(sections["relations"], RunDetailInspectionItem{
			Type:  "relation",
			ID:    relation.EdgeID,
			Label: relation.EdgeType,
			Kind:  relation.EdgeType,
			Data:  relation.Attributes,
		})
	}
	for _, diagnostic := range diagnostics {
		data, _ := json.Marshal(diagnostic)
		sections["diagnostics"] = append(sections["diagnostics"], RunDetailInspectionItem{
			Type:  "diagnostic",
			ID:    firstNonEmpty(strings.Join(diagnostic.RecordIDs, ","), strings.Join(diagnostic.SpanIDs, ","), diagnostic.Code),
			Label: diagnostic.Message,
			Kind:  diagnostic.Code,
			Data:  data,
		})
	}
	for _, detail := range details {
		section := inspectionSectionForFamily(detail.Family, detail.Primitive)
		data, _ := json.Marshal(detail)
		sections[section] = append(sections[section], RunDetailInspectionItem{
			Type:         "span",
			ID:           detail.SpanID,
			Label:        detail.Label,
			Kind:         detail.Primitive,
			Role:         detail.Role,
			SourceSpanID: detail.SpanID,
			Data:         data,
		})
	}
	if len(span.Attributes) > 0 && string(span.Attributes) != "null" && string(span.Attributes) != "{}" {
		sections["raw"] = append(sections["raw"], RunDetailInspectionItem{
			Type:         "span.attributes",
			ID:           "attributes:" + firstNonEmpty(span.SpanID, span.RunID),
			Label:        "Span attributes",
			Kind:         span.Primitive,
			SourceSpanID: span.SpanID,
			Data:         span.Attributes,
		})
	}
	if len(span.Metrics) > 0 && string(span.Metrics) != "null" {
		sections["metrics"] = append(sections["metrics"], RunDetailInspectionItem{
			Type:         "metric",
			ID:           "metrics:" + firstNonEmpty(span.SpanID, span.RunID),
			Label:        "Direct metrics",
			SourceSpanID: span.SpanID,
			Data:         span.Metrics,
		})
	}
	if len(sections) == 0 {
		return nil
	}
	return sections
}

func inspectionArtifactItem(artifact ArtifactSummary) (string, json.RawMessage) {
	if !isContextInspectionArtifact(artifact.Kind) {
		return artifact.Kind, artifact.Preview
	}

	label := firstNonEmpty(
		jsonStringField(artifact.Attributes, "contextId"),
		jsonStringField(artifact.Attributes, "source"),
		"context",
	)
	preview := artifact.Preview
	if len(preview) == 0 {
		preview = json.RawMessage("null")
	}
	data, err := json.Marshal(struct {
		SpanID     string            `json:"spanId,omitempty"`
		Family     string            `json:"family"`
		Primitive  string            `json:"primitive"`
		Name       string            `json:"name"`
		Attributes json.RawMessage   `json:"attributes,omitempty"`
		Artifacts  []ArtifactSummary `json:"artifacts"`
	}{
		SpanID:     artifact.SpanID,
		Family:     "context",
		Primitive:  "context.resolve",
		Name:       label,
		Attributes: artifact.Attributes,
		Artifacts: []ArtifactSummary{{
			ArtifactID:  artifact.ArtifactID,
			RunID:       artifact.RunID,
			TraceID:     artifact.TraceID,
			SpanID:      artifact.SpanID,
			Kind:        artifact.Kind,
			CreatedAt:   artifact.CreatedAt,
			ContentType: artifact.ContentType,
			Encoding:    artifact.Encoding,
			SizeBytes:   artifact.SizeBytes,
			Hash:        artifact.Hash,
			URI:         artifact.URI,
			Preview:     preview,
			Attributes:  artifact.Attributes,
		}},
	})
	if err != nil {
		return label, artifact.Preview
	}
	return label, data
}

func isContextInspectionArtifact(kind string) bool {
	return kind == "context" || kind == "context.contribution"
}

func appendMissingArtifacts(base []ArtifactSummary, candidates ...ArtifactSummary) []ArtifactSummary {
	if len(candidates) == 0 {
		return base
	}
	seen := make(map[string]struct{}, len(base))
	for _, artifact := range base {
		seen[artifact.ArtifactID] = struct{}{}
	}
	out := append([]ArtifactSummary(nil), base...)
	for _, candidate := range candidates {
		if _, ok := seen[candidate.ArtifactID]; ok {
			continue
		}
		out = append(out, candidate)
		seen[candidate.ArtifactID] = struct{}{}
	}
	return out
}

func toolCallIDFromSpan(span SpanSummary) string {
	if value := jsonStringField(span.Attributes, "toolCallId"); value != "" {
		return value
	}
	if value := jsonStringField(span.Attributes, "tool_call_id"); value != "" {
		return value
	}
	return ""
}

func toolCallIDFromArtifact(artifact ArtifactSummary) string {
	if value := jsonStringField(artifact.Attributes, "toolCallId"); value != "" {
		return value
	}
	if value := jsonStringField(artifact.Attributes, "tool_call_id"); value != "" {
		return value
	}
	if value := jsonStringField(artifact.Preview, "toolCallId"); value != "" {
		return value
	}
	if value := jsonStringField(artifact.Preview, "tool_call_id"); value != "" {
		return value
	}
	return ""
}

func jsonStringField(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return ""
	}
	value, ok := decoded[key]
	if !ok {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	default:
		return fmt.Sprint(v)
	}
}

func inspectionSectionForArtifact(kind string) string {
	switch kind {
	case "error.stack", "error.raw":
		return "errors"
	case "input", "prompt", "system":
		return "input"
	case "output":
		return "output"
	case "messages":
		return "messages"
	case "handoff.payload":
		return "output"
	case "context", "context.contribution", "prompt.budget":
		return "context"
	case "tool.args", "tool.request", "tool.result":
		return "tools"
	case "retrieval.hits":
		return "retrieval"
	case "memory.snapshot":
		return "memory"
	case "constraint.report", "guardrail.report":
		return "safety"
	case "security.report":
		return "safety"
	case "score.report":
		return "scores"
	case "citation.report":
		return "citations"
	case "composition.report":
		return "events"
	case "delegate.report":
		return "output"
	case "routing.report", "cache.report", "compaction.report":
		return "context"
	case "embedding.report", "indexing.report", "ingest.report", "corpus.report":
		return "retrieval"
	default:
		return "raw"
	}
}

func hasJSONValue(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null" && trimmed != "{}"
}

func inspectionSectionForFamily(family, primitive string) string {
	switch family {
	case "prompt", "context":
		return "context"
	case "memory":
		return "memory"
	case "retrieval", "embedding":
		return "retrieval"
	case "tool":
		return "tools"
	case "handoff", "delegate":
		return "output"
	case "constraint", "guardrail", "security":
		return "safety"
	case "scoring", "eval":
		return "scores"
	case "citation":
		return "citations"
	default:
		if primitive == "flow.suspension" {
			return "events"
		}
		return "raw"
	}
}

func resetRunDetailIndex(root *RunDetailNode, spanIndex map[string]RunDetailPlacement) {
	for key := range spanIndex {
		delete(spanIndex, key)
	}
	updateRunDetailPaths(root, spanIndex)
}

func virtualRunDetailRoot(run RunSummary) RunDetailNode {
	return virtualRunDetailRootAt(run, time.Now())
}

func virtualRunDetailRootAt(run RunSummary, now time.Time) RunDetailNode {
	return RunDetailNode{
		SpanSummary: SpanSummary{
			RunID:      run.RunID,
			TraceID:    run.TraceID,
			Family:     "run",
			Primitive:  run.RootPrimitive,
			Name:       run.Name,
			Status:     run.Status,
			StartedAt:  run.StartedAt,
			EndedAt:    run.EndedAt,
			DurationMs: run.DurationMs,
			Model:      run.Model,
			Provider:   run.Provider,
			PromptID:   run.PromptID,
			Attributes: run.Attributes,
			Metrics:    run.Metrics,
			Error:      run.Error,
		},
		ID:            "run:" + run.RunID,
		Virtual:       true,
		Path:          []string{"run:" + run.RunID},
		Kind:          "run",
		Display:       RunDetailDisplay{Kind: "run", Label: firstNonEmpty(run.Name, run.RunID), Severity: severityForStatus(run.Status)},
		Timing:        RunDetailTiming{StartedAt: run.StartedAt, EndedAt: run.EndedAt, DurationMs: run.DurationMs},
		MetricBuckets: RunDetailMetricBuckets{Own: emptyRawAsNil(run.Metrics), Total: emptyRawAsNil(run.Metrics)},
		Diagnostics:   runDiagnosticsAt(run, now),
		Children:      []RunDetailNode{},
	}
}

func reparentRunDetailChildren(children []RunDetailNode, parentID string, parentPath []string, spanIndex map[string]RunDetailPlacement) []RunDetailNode {
	for i := range children {
		children[i].ParentID = parentID
		children[i].Path = append(append([]string(nil), parentPath...), children[i].ID)
		updateRunDetailPaths(&children[i], spanIndex)
	}
	return children
}

func updateRunDetailPaths(node *RunDetailNode, spanIndex map[string]RunDetailPlacement) {
	if node.SpanID != "" {
		spanIndex[node.SpanID] = RunDetailPlacement{Placement: "node", NodeID: node.ID, Path: node.Path, Reason: "primary"}
	}
	for _, detail := range node.Details {
		detailPath := append(append([]string(nil), node.Path...), detail.ID)
		spanIndex[detail.SpanID] = RunDetailPlacement{Placement: "detail", OwnerNodeID: node.ID, Path: detailPath, Reason: detail.Source.PlacementReason}
	}
	for i := range node.Children {
		node.Children[i].ParentID = node.ID
		node.Children[i].Path = append(append([]string(nil), node.Path...), node.Children[i].ID)
		updateRunDetailPaths(&node.Children[i], spanIndex)
	}
}

func flattenRunDetailRows(root RunDetailNode) []RunDetailRow {
	var rows []RunDetailRow
	var visit func(RunDetailNode, int)
	visit = func(node RunDetailNode, depth int) {
		model := node.Model
		provider := node.Provider
		if node.Request != nil && node.Request.ModelSummary != nil {
			model = firstNonEmpty(model, node.Request.ModelSummary.PrimaryModel)
			provider = firstNonEmpty(provider, node.Request.ModelSummary.PrimaryProvider)
		}
		rows = append(rows, RunDetailRow{
			NodeID:          node.ID,
			SpanID:          node.SpanID,
			ParentID:        node.ParentID,
			Depth:           depth,
			Path:            node.Path,
			HasChildren:     len(node.Children) > 0,
			ExpandedDefault: depth < 2,
			Display:         node.Display,
			Status:          node.Status,
			Model:           model,
			Provider:        provider,
			Timing:          node.Timing,
		})
		for _, child := range node.Children {
			visit(child, depth+1)
		}
	}
	visit(root, 0)
	return rows
}

func buildRunDetailFacets(graph Graph) map[string]map[string]int {
	facets := map[string]map[string]int{
		"family":    {},
		"primitive": {},
		"status":    {},
		"model":     {},
		"provider":  {},
	}
	for _, span := range graph.Spans {
		incrementFacet(facets["family"], span.Family)
		incrementFacet(facets["primitive"], span.Primitive)
		incrementFacet(facets["status"], span.Status)
		incrementFacet(facets["model"], span.Model)
		incrementFacet(facets["provider"], span.Provider)
	}
	return facets
}

func incrementFacet(values map[string]int, value string) {
	if value == "" {
		return
	}
	values[value]++
}

func rootMatchesRun(run RunSummary, span SpanSummary) bool {
	if run.RootPrimitive != "" && run.RootPrimitive == span.Primitive {
		return true
	}
	return normalizeDisplayName(run.Name) != "" && normalizeDisplayName(run.Name) == normalizeDisplayName(span.Name)
}

func runDetailTiming(span SpanSummary) RunDetailTiming {
	return RunDetailTiming{
		StartedAt:  span.StartedAt,
		EndedAt:    span.EndedAt,
		DurationMs: span.DurationMs,
	}
}

func runDetailDisplay(span SpanSummary) RunDetailDisplay {
	kind := runDetailKind(span.Family, span.Primitive)
	label := presentationLabelOverride(span.Attributes)
	if span.Family != "generation" && label != "" && label == span.Model {
		label = ""
	}
	if label == "" {
		label = firstNonEmpty(span.ToolName, span.AgentID, span.FlowID, span.StepID, span.PromptID, span.ContextID, span.MemoryID, span.RetrieverID, span.Name, span.Primitive, span.SpanID)
	}
	if span.Family != "generation" && label == span.Model {
		label = firstNonEmpty(span.ToolName, span.AgentID, span.FlowID, span.StepID, span.PromptID, span.ContextID, span.MemoryID, span.RetrieverID, span.Primitive, span.SpanID)
	}
	return RunDetailDisplay{
		Kind:     kind,
		Label:    label,
		Severity: severityForStatus(span.Status),
	}
}

func runDetailKind(family, primitive string) string {
	switch {
	case primitive == "flow.suspension":
		return "suspension"
	case primitive == "flow.step":
		return "step"
	case family == "handoff" || family == "delegate":
		return "transition"
	case family == "generation", family == "agent", family == "tool", family == "flow", family == "composition", family == "memory", family == "retrieval":
		return family
	case family == "constraint", family == "guardrail", family == "citation", family == "scoring", family == "security":
		return family
	case family == "prompt" || family == "context" || family == "routing" || family == "cache" || family == "cost":
		return "detail"
	default:
		return "operation"
	}
}

func detailRole(span SpanSummary) string {
	switch span.Family {
	case "prompt", "context", "memory", "retrieval":
		return "input"
	case "routing":
		return "decision"
	case "cost":
		return "accounting"
	case "constraint", "guardrail", "security":
		return "guard"
	default:
		return ""
	}
}

func detailPlacementReason(span SpanSummary) string {
	if owner := presentationOwnerOverride(span.Attributes); owner != "" {
		return "owner-hint"
	}
	if span.ParentSpanID != "" {
		return "chronology"
	}
	return "chronology"
}

func severityForStatus(status string) string {
	switch status {
	case "ok", "success", "skipped":
		return "ok"
	case "error", "cancelled", "blocked":
		return "error"
	case "warn", "warning", "stale", "incomplete", "suspended":
		return "warn"
	default:
		return "info"
	}
}

func presentationLabelOverride(attributes json.RawMessage) string {
	if len(attributes) == 0 {
		return ""
	}
	var decoded struct {
		Presentation struct {
			Label string `json:"label"`
		} `json:"presentation"`
	}
	if err := json.Unmarshal(attributes, &decoded); err != nil {
		return ""
	}
	return decoded.Presentation.Label
}

func presentationOwnerOverride(attributes json.RawMessage) string {
	if len(attributes) == 0 {
		return ""
	}
	var decoded struct {
		Presentation struct {
			OwnerSpanID string `json:"ownerSpanId"`
		} `json:"presentation"`
	}
	if err := json.Unmarshal(attributes, &decoded); err != nil {
		return ""
	}
	return decoded.Presentation.OwnerSpanID
}

func ownerSpanIDFromNodeID(nodeID string) string {
	if strings.HasPrefix(nodeID, "span:") {
		return strings.TrimPrefix(nodeID, "span:")
	}
	return ""
}

func normalizeDisplayName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	value = strings.ReplaceAll(value, " ", "-")
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func emptyRawAsNil(value json.RawMessage) json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	return value
}

func sumChildDuration(children []RunDetailNode) float64 {
	var total float64
	for _, child := range children {
		total += child.DurationMs
	}
	return total
}

func sumDetailDuration(details []RunDetailDetail) float64 {
	var total float64
	for _, detail := range details {
		total += detail.DurationMs
	}
	return total
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func isStaleTimestamp(timestamp string) bool {
	return isStaleTimestampAt(timestamp, time.Now())
}

func isStaleTimestampAt(timestamp string, now time.Time) bool {
	if timestamp == "" {
		return false
	}
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return false
	}
	return now.Sub(parsed) > 60*time.Second
}

func durationSinceTimestamp(timestamp string) float64 {
	return durationSinceTimestampAt(timestamp, time.Now())
}

func durationSinceTimestampAt(timestamp string, now time.Time) float64 {
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return 0
	}
	return float64(max(int64(0), now.Sub(parsed).Milliseconds()))
}
