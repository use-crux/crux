package inspect

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func inputFromObservabilityRunDetail(detail observability.RunDetail) map[string]any {
	for _, kind := range []string{"input", "messages", "prompt"} {
		if preview, ok := artifactPreviewFromRunDetail(detail.Root, kind); ok {
			return preview
		}
	}
	return map[string]any{}
}

func artifactPreviewFromRunDetail(root observability.RunDetailNode, kind string) (map[string]any, bool) {
	for _, node := range flattenRunDetailNodes(root) {
		if preview, ok := artifactPreviewFromSummaries(node.Artifacts, kind); ok {
			return preview, true
		}
		for _, detail := range node.Details {
			if preview, ok := artifactPreviewFromSummaries(detail.Artifacts, kind); ok {
				return preview, true
			}
		}
	}
	return nil, false
}

func artifactPreviewFromSummaries(artifacts []observability.ArtifactSummary, kind string) (map[string]any, bool) {
	for _, artifact := range artifacts {
		if artifact.Kind != kind {
			continue
		}
		preview := jsonObject(artifact.Preview)
		if len(preview) > 0 {
			return preview, true
		}
	}
	return nil, false
}

func flattenRunDetailNodes(root observability.RunDetailNode) []observability.RunDetailNode {
	var nodes []observability.RunDetailNode
	var visit func(observability.RunDetailNode)
	visit = func(node observability.RunDetailNode) {
		nodes = append(nodes, node)
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return nodes
}

func indexRunDetailNodes(node observability.RunDetailNode, out map[string]observability.RunDetailNode) {
	out[node.ID] = node
	for _, child := range node.Children {
		indexRunDetailNodes(child, out)
	}
}

func runDetailParentSpanID(parentID string, nodesByID map[string]observability.RunDetailNode) string {
	if parentID == "" {
		return ""
	}
	parent, ok := nodesByID[parentID]
	if !ok {
		return ""
	}
	return parent.SpanID
}

func isVirtualRunDetailRoot(node observability.RunDetailNode) bool {
	return node.Virtual && node.SpanID == ""
}

func firstRawMessage(values ...json.RawMessage) json.RawMessage {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func compositionTypeFromPrimitive(primitive string) string {
	switch primitive {
	case "composition.pipeline":
		return "pipeline"
	case "composition.parallel":
		return "parallel"
	case "composition.consensus":
		return "consensus"
	case "composition.swarm":
		return "swarm"
	default:
		return ""
	}
}

func jsonObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	return obj
}

func jsonAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func stringAttributes(raw json.RawMessage) map[string]string {
	obj := jsonObject(raw)
	if len(obj) == 0 {
		return nil
	}
	out := make(map[string]string, len(obj))
	for key, value := range obj {
		switch typed := value.(type) {
		case string:
			out[key] = typed
		case bool, float64, int:
			out[key] = fmt.Sprint(typed)
		}
	}
	return out
}

func intMetric(metrics map[string]any, key string) int {
	value, ok := metrics[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func floatMetric(metrics map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := metrics[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed, true
		case int:
			return float64(typed), true
		}
	}
	return 0, false
}

func optionalFloatMetric(metrics map[string]any, keys ...string) *float64 {
	if value, ok := floatMetric(metrics, keys...); ok {
		return &value
	}
	return nil
}

func stringMetric(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return value
		}
	}
	return ""
}

func optionalStringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func optionalDuration(value float64) *float64 {
	if value <= 0 {
		return nil
	}
	return &value
}

func parseTimeMillis(value string) int64 {
	if value == "" {
		return 0
	}
	ts, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return ts.UnixMilli()
}

func normalizeStatus(status string) string {
	switch status {
	case "success", "passed":
		return "ok"
	case "error":
		return "error"
	default:
		return status
	}
}

func inspectRunKindFromRootPrimitive(rootPrimitive string) string {
	switch {
	case rootPrimitive == "composition", strings.HasPrefix(rootPrimitive, "composition."):
		return "composition"
	case rootPrimitive == "agent", strings.HasPrefix(rootPrimitive, "agent."):
		return "agent"
	case rootPrimitive == "flow", strings.HasPrefix(rootPrimitive, "flow."):
		return "flow"
	case rootPrimitive == "generation", strings.HasPrefix(rootPrimitive, "generation."):
		return "generation"
	case rootPrimitive == "retrieval", strings.HasPrefix(rootPrimitive, "retrieval."):
		return "retrieval"
	case rootPrimitive == "eval", strings.HasPrefix(rootPrimitive, "eval."), strings.HasPrefix(rootPrimitive, "scoring."):
		return "eval"
	case rootPrimitive == "":
		return ""
	default:
		return "operation"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
