package screens

import (
	"encoding/json"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func inspectRunDetailFromObservabilityDetail(detail api.ObservabilityRunDetail) api.InspectRunDetailRecord {
	run := inspectRunFromObservability(detail.Run)
	trace := api.InspectTraceRecord{
		TraceID:    detail.Run.RunID,
		StartedAt:  parseObservabilityTime(detail.Run.StartedAt),
		Model:      detail.Run.Model,
		Provider:   detail.Run.Provider,
		DurationMs: durationPointer(detail.Run.DurationMs),
		Status:     normalizeObservabilityStatus(detail.Run.Status),
	}
	spans := inspectSpansFromRunDetailNode(detail.Root)
	events := make([]api.CorrelatedEvent, 0)
	for _, span := range spans {
		if len(span.Data) == 0 {
			continue
		}
	}
	return api.InspectRunDetailRecord{
		Tag:       "InspectRunDetail",
		Run:       run,
		Trace:     trace,
		Events:    events,
		Spans:     spans,
		Narrative: []api.InspectRunNarrativeEvent{},
	}
}

func inspectSpansFromRunDetailNode(root api.ObservabilityRunDetailNode) []api.InspectRunSpan {
	var spans []api.InspectRunSpan
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		data, _ := json.Marshal(buildSpanDataPayload(node))
		attrs := map[string]string{
			"family":    node.Family,
			"primitive": node.Primitive,
			"run_id":    node.RunID,
			"trace_id":  node.TraceID,
		}
		addStringAttr(attrs, "prompt_id", node.PromptID)
		addStringAttr(attrs, "context_id", node.ContextID)
		addStringAttr(attrs, "agent_id", node.AgentID)
		addStringAttr(attrs, "tool_name", node.ToolName)
		addStringAttr(attrs, "flow_id", node.FlowID)
		addStringAttr(attrs, "step_id", node.StepID)
		addStringAttr(attrs, "memory_id", node.MemoryID)
		addStringAttr(attrs, "retriever_id", node.RetrieverID)
		spans = append(spans, api.InspectRunSpan{
			ID:         firstNonEmpty(node.SpanID, node.ID),
			ParentID:   strings.TrimPrefix(node.ParentID, "span:"),
			Kind:       node.Display.Kind,
			Op:         node.Primitive,
			Primitive:  inspectPrimitiveFromObservability(node.Family, node.Primitive),
			Name:       node.Display.Label,
			Status:     normalizeObservabilityStatus(node.Status),
			StartedAt:  parseObservabilityTime(node.Timing.StartedAt),
			EndedAt:    parseObservabilityTime(node.Timing.EndedAt),
			DurationMs: durationPointer(node.Timing.DurationMs),
			EventType:  node.Primitive,
			Attributes: attrs,
			Data:       data,
			Error:      node.Error,
			Inspection: node.Inspection,
		})
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return spans
}

// buildSpanDataPayload flattens the rich RunDetailNode into a map the
// per-primitive renderers in payload.go can consume directly.
//
// Background: the SpanSummary embedded in RunDetailNode carries typed
// columns (Model, Provider, ToolName, FlowID, StepID, RetrieverID,
// MemoryID, AgentID, PromptID, ContextID) AND a free-form Attributes
// JSON blob AND attached artifacts (tool.request, tool.response,
// retrieval.hits, handoff.payload, messages, output, …). The pre-fix
// projection threw the typed columns away — it only kept Attributes
// (and shoved the whole node under a `node` key). That's why no
// per-primitive renderer found its keys at runtime.
//
// The fix surfaces everything the renderers need at the top level of
// the Data map, then layers on extras from artifacts/metrics/raw
// attributes. We keep the `node`/`details`/`events`/`artifacts`/
// `relations`/`diagnostics` keys for the inspect-raw overlay.
func buildSpanDataPayload(node api.ObservabilityRunDetailNode) map[string]any {
	p := map[string]any{
		"node":        node,
		"details":     node.Details,
		"events":      node.Events,
		"artifacts":   node.Artifacts,
		"relations":   node.Relations,
		"diagnostics": node.Diagnostics,
	}
	// Typed columns from SpanSummary — only set when non-empty so the
	// `_, ok := p[...]` checks in renderers cleanly skip absent fields.
	setIfNonEmpty(p, "model", node.Model)
	setIfNonEmpty(p, "provider", node.Provider)
	setIfNonEmpty(p, "toolName", node.ToolName)
	setIfNonEmpty(p, "flowId", node.FlowID)
	setIfNonEmpty(p, "stepId", node.StepID)
	setIfNonEmpty(p, "retrieverId", node.RetrieverID)
	setIfNonEmpty(p, "memoryId", node.MemoryID)
	setIfNonEmpty(p, "agentId", node.AgentID)
	setIfNonEmpty(p, "promptId", node.PromptID)
	setIfNonEmpty(p, "contextId", node.ContextID)
	// Raw Attributes overlay — primitives like generation.call carry
	// finishReason, temperature, mode here. Merge LAST so typed
	// columns win when both are present, except attributes that don't
	// collide. Strategy: merge attributes first, then overwrite with
	// typed columns above. We do it in the opposite order, so:
	// 1. snapshot the typed values we just set,
	// 2. merge attrs (may overwrite),
	// 3. restore typed values.
	typed := make(map[string]any, 10)
	for _, k := range []string{"model", "provider", "toolName", "flowId", "stepId",
		"retrieverId", "memoryId", "agentId", "promptId", "contextId"} {
		if v, ok := p[k]; ok {
			typed[k] = v
		}
	}
	mergeRawObject(p, node.Attributes)
	for k, v := range typed {
		p[k] = v
	}
	// Metrics → expose at top level as `metrics` AND project the common
	// token fields into a `usage` sub-object so the generation renderer
	// (which expects usage.promptTokens/completionTokens) Just Works.
	if metrics := decodeRawObject(firstRawObject(node.MetricBuckets.Total, node.MetricBuckets.Own, node.Metrics)); len(metrics) > 0 {
		p["metrics"] = metrics
		usage := map[string]any{}
		if v, ok := metrics["inputTokens"]; ok {
			usage["promptTokens"] = v
		}
		if v, ok := metrics["outputTokens"]; ok {
			usage["completionTokens"] = v
		}
		if v, ok := metrics["totalTokens"]; ok {
			usage["totalTokens"] = v
		}
		if len(usage) > 0 {
			p["usage"] = usage
		}
		if v, ok := metrics["costUsd"]; ok {
			p["costUsd"] = v
		}
	}
	// Artifacts → project canonical previews into top-level keys so
	// renderers can show args / result / hits / messages / output /
	// handoff payload + sizes without the renderer needing to know
	// about artifact taxonomy.
	for _, art := range node.Artifacts {
		preview := decodeRawObject(art.Preview)
		switch art.Kind {
		case "tool.request", "tool.args":
			if args, ok := preview["args"]; ok {
				p["args"] = args
			}
			// preview may also carry toolName / toolCallId — surface
			// when the span column is empty.
			if _, has := p["toolName"]; !has {
				if v, ok := preview["toolName"]; ok {
					p["toolName"] = v
				}
			}
			if v, ok := preview["toolCallId"]; ok {
				p["toolCallId"] = v
			}
		case "tool.response", "tool.result":
			if r, ok := preview["result"]; ok {
				p["result"] = r
			} else if len(preview) > 0 {
				// Fall back to the whole preview as the result.
				p["result"] = preview
			}
			if art.SizeBytes > 0 {
				p["outputSize"] = art.SizeBytes
			}
		case "retrieval.hits":
			if hits, ok := preview["hits"]; ok {
				p["hits"] = hits
			}
		case "handoff.payload":
			if v, ok := preview["handoffId"]; ok {
				if _, has := p["handoffId"]; !has {
					p["handoffId"] = v
				}
			}
			if v, ok := preview["data"]; ok {
				p["payload"] = v
			}
			attrs := decodeRawObject(art.Attributes)
			if v, ok := attrs["inputSize"]; ok {
				p["inputSize"] = v
			}
			if v, ok := attrs["outputSize"]; ok {
				p["outputSize"] = v
			}
		case "messages":
			if msgs, ok := preview["messages"]; ok {
				p["input"] = msgs
			}
		case "output":
			// Generation answer artifact — surface as `output`. If the
			// preview is `{answer: "..."}` we unwrap so the rendered
			// row reads the answer directly.
			if ans, ok := preview["answer"]; ok {
				p["output"] = ans
			} else if len(preview) > 0 {
				p["output"] = preview
			}
		}
	}
	// _start is preserved on the wire for replay; strip from the
	// visible projection so it doesn't pollute the generic fallback.
	delete(p, "_start")
	return p
}

func setIfNonEmpty(m map[string]any, k, v string) {
	if v != "" {
		m[k] = v
	}
}

// decodeRawObject parses a json.RawMessage as a map[string]any, or
// returns nil when the input is empty/null/non-object.
func decodeRawObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// mergeRawObject decodes a json.RawMessage object and merges its keys
// into m (no-op when the message is empty/null/non-object). Used to
// overlay free-form span.Attributes onto the structured Data map.
func mergeRawObject(m map[string]any, raw json.RawMessage) {
	src := decodeRawObject(raw)
	for k, v := range src {
		m[k] = v
	}
}

// firstRawObject returns the first non-empty, non-null RawMessage in
// the given list. Used to prefer Total → Own → Metrics for the rolled
// up token counts.
func firstRawObject(candidates ...json.RawMessage) json.RawMessage {
	for _, c := range candidates {
		if len(c) > 0 && string(c) != "null" && string(c) != "{}" {
			return c
		}
	}
	return nil
}
