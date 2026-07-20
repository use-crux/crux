package screens

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func observabilityMetrics(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var metrics map[string]any
	if err := json.Unmarshal(raw, &metrics); err != nil {
		return nil
	}
	return metrics
}

func intMetric(metrics map[string]any, key string) int {
	switch value := metrics[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func addStringAttr(attrs map[string]string, key string, value string) {
	if value != "" {
		attrs[key] = value
	}
}

func inspectPrimitiveFromObservability(family, primitive string) string {
	switch family {
	case "composition":
		if suffix, ok := strings.CutPrefix(primitive, "composition."); ok {
			return suffix
		}
		return family
	case "generation":
		return api.SpanPrimitiveGeneration
	case "tool":
		return api.SpanPrimitiveTool
	case "agent":
		return api.SpanPrimitiveAgent
	case "flow":
		if primitive == "flow.step" {
			return api.SpanPrimitiveFlowStep
		}
		return api.SpanPrimitiveFlow
	case "retrieval":
		return api.SpanPrimitiveRetrieval
	case "embedding":
		return api.SpanPrimitiveEmbed
	case "memory":
		return api.SpanPrimitiveMemory
	case "handoff":
		return api.SpanPrimitiveHandoff
	case "delegate":
		return api.SpanPrimitiveDelegate
	case "scoring":
		return api.SpanPrimitiveJudge
	case "ingest":
		return api.SpanPrimitiveIngest
	case "corpus":
		return api.SpanPrimitiveCorpus
	case "skill":
		return api.SpanPrimitiveSkill
	case "security":
		return api.SpanPrimitiveSecurity
	case "cost":
		return api.SpanPrimitiveCost
	default:
		if family != "" {
			return family
		}
		return api.SpanPrimitiveOther
	}
}

func normalizeObservabilityStatus(status string) string {
	switch status {
	case "ok", "success":
		return "ok"
	case "error", "failed", "fail":
		return "fail"
	case "cancelled", "canceled":
		return "cancelled"
	default:
		if status == "" {
			return "unknown"
		}
		return status
	}
}

func parseObservabilityTime(value string) int64 {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func durationPointer(ms float64) *float64 {
	if ms <= 0 {
		return nil
	}
	return &ms
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
