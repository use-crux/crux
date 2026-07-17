package inspect

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func narrativeFromObservabilityRunDetail(detail observability.RunDetail) []inspectRunNarrativeEvent {
	start := parseTimeMillis(detail.Run.StartedAt)
	nodesByID := map[string]observability.RunDetailNode{}
	indexRunDetailNodes(detail.Root, nodesByID)
	events := make([]inspectRunNarrativeEvent, 0, len(detail.Rows))
	for _, row := range detail.Rows {
		node, ok := nodesByID[row.NodeID]
		if !ok || isVirtualRunDetailRoot(node) {
			continue
		}
		ts := parseTimeMillis(row.Timing.StartedAt)
		events = append(events, inspectRunNarrativeEvent{
			ID:        node.SpanID,
			Kind:      firstNonEmpty(row.Display.Kind, node.Family),
			Label:     firstNonEmpty(row.Display.Label, node.Name, node.Primitive),
			Timestamp: ts,
			OffsetMs:  ts - start,
			Data:      map[string]any{"primitive": node.Primitive, "status": node.Status, "attributes": jsonObject(node.Attributes)},
		})
	}
	for _, node := range flattenRunDetailNodes(detail.Root) {
		for _, attached := range node.Details {
			ts := parseTimeMillis(attached.Timing.StartedAt)
			events = append(events, inspectRunNarrativeEvent{
				ID:        attached.SpanID,
				Kind:      firstNonEmpty(attached.Kind, attached.Family),
				Label:     firstNonEmpty(attached.Label, attached.Name, attached.Primitive),
				Timestamp: ts,
				OffsetMs:  ts - start,
				Data:      map[string]any{"primitive": attached.Primitive, "status": attached.Status, "attributes": jsonObject(attached.Attributes), "attachedTo": node.SpanID},
			})
			events = appendNarrativeArtifactEvents(events, attached.Artifacts, attached.SpanSummary, start)
		}
		events = appendNarrativeArtifactEvents(events, node.Artifacts, node.SpanSummary, start)
		for _, event := range node.Events {
			ts := parseTimeMillis(event.Timestamp)
			events = append(events, inspectRunNarrativeEvent{
				ID:        event.EventID,
				Kind:      "event",
				Label:     event.Name,
				Timestamp: ts,
				OffsetMs:  ts - start,
				Data:      jsonObject(event.Attributes),
			})
		}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Timestamp < events[j].Timestamp })
	return events
}

func appendNarrativeArtifactEvents(events []inspectRunNarrativeEvent, artifacts []observability.ArtifactSummary, owner observability.SpanSummary, start int64) []inspectRunNarrativeEvent {
	for _, artifact := range artifacts {
		kind, label, data := narrativeArtifactEventData(artifact, owner)
		if kind == "" {
			continue
		}
		ts := parseTimeMillis(artifact.CreatedAt)
		events = append(events, inspectRunNarrativeEvent{
			ID:        artifact.ArtifactID,
			Kind:      kind,
			Label:     label,
			Timestamp: ts,
			OffsetMs:  ts - start,
			Data:      data,
		})
	}
	return events
}

func narrativeArtifactEventData(artifact observability.ArtifactSummary, owner observability.SpanSummary) (string, string, map[string]any) {
	preview := jsonAny(artifact.Preview)
	attrs := jsonObject(artifact.Attributes)
	actor := firstNonEmpty(owner.ToolName, stringMetric(attrs, "toolName", "tool_name"), owner.Name, owner.Primitive)
	data := map[string]any{
		"actor": actor,
		"body":  preview,
		"meta":  narrativeMetricMeta(artifact.Kind, owner),
	}
	if owner.Primitive != "" {
		data["primitive"] = owner.Primitive
	}

	switch artifact.Kind {
	case "input", "messages", "prompt", "system":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "input", artifact.Kind, data
	case "output", "stream.timeline":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "output", artifact.Kind, data
	case "tool.args", "tool.request", "tool.result":
		return "tool", firstNonEmpty(actor, artifact.Kind), data
	case "retrieval.hits":
		if detail := narrativeHitCountDetail(preview); detail != "" {
			data["detail"] = detail
		}
		if query := narrativeStringField(preview, "query"); query != "" {
			data["text"] = query
		}
		return "retrieval", "retrieval hits", data
	case "score.report":
		if detail := narrativeStringField(preview, "reasoning", "reasoningPreview", "rationale"); detail != "" {
			data["detail"] = detail
		}
		return "score", "score report", data
	case "citation.report":
		if detail := narrativeCitationDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "citation", "citation report", data
	case "memory.snapshot":
		if detail := narrativeMemoryDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "memory", "memory snapshot", data
	case "handoff.payload":
		return "handoff", "handoff payload", data
	case "delegate.report":
		if detail := narrativeStringField(preview, "delegateId", "handoffId"); detail != "" {
			data["detail"] = detail
		}
		return "delegate", "delegate report", data
	case "constraint.report", "guardrail.report":
		return "safety", artifact.Kind, data
	case "security.report":
		if detail := narrativeStringField(preview, "message", "pattern"); detail != "" {
			data["detail"] = detail
		}
		return "safety", "security warning", data
	case "error.stack", "error.raw":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "error", artifact.Kind, data
	case "composition.report":
		if detail := narrativeStringField(preview, "compositionType", "status"); detail != "" {
			data["detail"] = detail
		}
		return "composition", "composition report", data
	case "routing.report":
		if detail := narrativeStringField(preview, "chosen", "selectedModel", "classifiedAs"); detail != "" {
			data["detail"] = detail
		}
		return "routing", "routing report", data
	case "cache.report":
		if detail := narrativeCacheDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "cache", "cache report", data
	case "compaction.report":
		if text := narrativeStringField(preview, "summarizedPreview"); text != "" {
			data["text"] = text
		}
		return "compaction", "compaction report", data
	case "embedding.report":
		if detail := narrativeEmbeddingDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "embedding", "embedding report", data
	case "indexing.report", "ingest.report", "corpus.report":
		if detail := narrativeIndexingDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "indexing", artifact.Kind, data
	default:
		return "", "", nil
	}
}
