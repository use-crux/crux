package inspect

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func narrativeMetricMeta(kind string, owner observability.SpanSummary) string {
	parts := []string{kind}
	metrics := jsonObject(owner.Metrics)
	if tokens := firstPositiveIntMetric(metrics, "totalTokens", "tokenCount", "tokens"); tokens > 0 {
		parts = append(parts, fmt.Sprintf("%d tokens", tokens))
	}
	if cost := optionalFloatMetric(metrics, "costUsd", "cost"); cost != nil && *cost > 0 {
		parts = append(parts, fmt.Sprintf("$%.4f", *cost))
	}
	return strings.Join(parts, " | ")
}

func firstPositiveIntMetric(metrics map[string]any, keys ...string) int {
	for _, key := range keys {
		if value := intMetric(metrics, key); value > 0 {
			return value
		}
	}
	return 0
}

func narrativeTextFromPreview(preview any) string {
	switch value := preview.(type) {
	case string:
		return value
	case map[string]any:
		return firstNonEmpty(
			stringMetric(value, "text"),
			stringMetric(value, "output"),
			stringMetric(value, "answer"),
			stringMetric(value, "content"),
		)
	default:
		return ""
	}
}

func narrativeStringField(preview any, keys ...string) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	return stringMetric(obj, keys...)
}

func narrativeHitCountDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	count, found := numericAnyMetric(obj, "returned", "resultCount", "hitCount", "count")
	if !found {
		if hits, ok := obj["hits"].([]any); ok {
			count = len(hits)
			found = true
		}
	}
	if !found {
		return ""
	}
	if count == 1 {
		return "1 hit"
	}
	return fmt.Sprintf("%d hits", count)
}

func narrativeCitationDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	if note := stringMetric(obj, "note", "summary"); note != "" {
		return note
	}
	markers, ok := obj["markers"].([]any)
	if !ok {
		return ""
	}
	if len(markers) == 1 {
		return "1 marker"
	}
	return fmt.Sprintf("%d markers", len(markers))
}

func narrativeMemoryDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	memoryType := firstNonEmpty(stringMetric(obj, "memoryType"), stringMetric(obj, "blockKind"), "memory")
	blocks, ok := obj["blocks"].([]any)
	if !ok {
		return memoryType
	}
	if len(blocks) == 1 {
		return memoryType + " | 1 block"
	}
	return fmt.Sprintf("%s | %d blocks", memoryType, len(blocks))
}

func narrativeCacheDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	status := stringMetric(obj, "status")
	if status == "" {
		return ""
	}
	hitCount, hasHits := numericAnyMetric(obj, "hitCount")
	missCount, hasMisses := numericAnyMetric(obj, "missCount")
	if hasHits || hasMisses {
		return fmt.Sprintf("%s | %d hits | %d misses", status, hitCount, missCount)
	}
	return status
}

func narrativeEmbeddingDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	kind := firstNonEmpty(stringMetric(obj, "embeddingKind"), "embedding")
	inputCount, found := numericAnyMetric(obj, "inputCount")
	if !found {
		return kind
	}
	return fmt.Sprintf("%s | %d inputs", kind, inputCount)
}

func narrativeIndexingDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	if status := stringMetric(obj, "status"); status != "" {
		return status
	}
	totals, ok := obj["totals"].(map[string]any)
	if !ok {
		return stringMetric(obj, "operation")
	}
	chunks, _ := numericAnyMetric(totals, "chunks", "chunkCount")
	sources, _ := numericAnyMetric(totals, "sources", "sourceCount")
	return fmt.Sprintf("%d sources | %d chunks", sources, chunks)
}
