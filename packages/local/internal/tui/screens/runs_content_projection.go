package screens

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

type runHeaderContent struct {
	Composition string
	Models      string
	Delivery    string
	Redacted    int
}

func projectRunHeader(detail api.ObservabilityRunDetail) runHeaderContent {
	return runHeaderContent{
		Composition: facetSummary(detail.Facets),
		Models:      modelFacetSummary(detail),
		Delivery:    abnormalDelivery(detail.Run.DeliveryHealth),
		Redacted:    redactionSurfaceCount(detail.Redaction),
	}
}

func facetSummary(facets map[string]map[string]int) string {
	counts := facets["family"]
	if len(counts) == 0 {
		counts = facets["primitive"]
	}
	keys := sortedCountKeys(counts)
	parts := make([]string, 0, min(2, len(keys)))
	for _, key := range keys[:min(2, len(keys))] {
		label := key
		if counts[key] > 1 {
			label = fmt.Sprintf("%s %d", key, counts[key])
		}
		parts = append(parts, label)
	}
	if len(keys) > 2 {
		parts = append(parts, fmt.Sprintf("+%d", len(keys)-2))
	}
	return strings.Join(parts, " · ")
}

func modelFacetSummary(detail api.ObservabilityRunDetail) string {
	models := detail.Facets["model"]
	if len(models) == 0 {
		if detail.Run.Model == "" {
			return ""
		}
		return detail.Run.Model
	}
	keys := sortedCountKeys(models)
	if len(keys) == 1 {
		return keys[0]
	}
	return fmt.Sprintf("%d models mixed", len(keys))
}

func sortedCountKeys(counts map[string]int) []string {
	keys := make([]string, 0, len(counts))
	for key, count := range counts {
		if key != "" && count > 0 {
			keys = append(keys, key)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if counts[keys[i]] == counts[keys[j]] {
			return keys[i] < keys[j]
		}
		return counts[keys[i]] > counts[keys[j]]
	})
	return keys
}

func abnormalDelivery(health *observability.RunDeliveryHealth) string {
	if health == nil || health.Status == "" || health.Status == "healthy" || health.Status == "unknown" {
		return ""
	}
	if health.Rejected > 0 {
		return fmt.Sprintf("%s · %d rejected", health.Status, health.Rejected)
	}
	return health.Status
}

func redactionSurfaceCount(evidence *observability.ObservabilityRedactionEvidence) int {
	if evidence == nil || !evidence.Applied {
		return 0
	}
	return len(evidence.Surfaces)
}

type spanSplitContent struct {
	SelfMs, ChildrenMs, DetailsMs float64
	Input, Cache, Output          float64
}

func projectSpanSplits(node api.ObservabilityRunDetailNode) spanSplitContent {
	metrics := numericRawObject(firstRawObject(node.MetricBuckets.Total, node.Metrics))
	return spanSplitContent{
		SelfMs: node.Timing.SelfMs, ChildrenMs: node.Timing.ChildrenMs, DetailsMs: node.Timing.DetailsMs,
		Input: metrics["inputTokens"], Cache: metrics["cacheReadTokens"], Output: metrics["outputTokens"],
	}
}

func numericRawObject(raw json.RawMessage) map[string]float64 {
	out := map[string]float64{}
	for key, value := range decodeRawObject(raw) {
		if number, ok := value.(float64); ok && number > 0 {
			out[key] = number
		}
	}
	return out
}

type mediaDescriptor struct {
	Kind, ContentType, Source, Lineage string
	SizeBytes                          int64
}

func projectMediaDescriptors(node api.ObservabilityRunDetailNode) []mediaDescriptor {
	var descriptors []mediaDescriptor
	for _, artifact := range node.Artifacts {
		collectMediaDescriptors(decodeRawObject(artifact.Preview), artifact, &descriptors)
	}
	return descriptors
}

func collectMediaDescriptors(value any, artifact observability.ArtifactSummary, out *[]mediaDescriptor) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			collectMediaDescriptors(item, artifact, out)
		}
	case map[string]any:
		kind := firstNonEmpty(stringField(typed, "kind"), stringField(typed, "type"))
		if kind == "image" || kind == "audio" || kind == "video" || kind == "file" {
			size := int64(intField(typed, "sizeBytes"))
			if size == 0 {
				size = artifact.SizeBytes
			}
			*out = append(*out, mediaDescriptor{
				Kind: kind, ContentType: firstNonEmpty(stringField(typed, "mediaType"), artifact.ContentType),
				Source: stringField(typed, "sourceCategory"), SizeBytes: size,
				Lineage: strings.Trim(strings.Join([]string{artifact.Kind, artifact.ArtifactID}, " · "), " ·"),
			})
			return
		}
		for _, item := range typed {
			collectMediaDescriptors(item, artifact, out)
		}
	}
}

type memoryCaptureContent struct {
	MemoryID, RequestedMode, Disposition, Outcome string
}

func projectMemoryCapture(node api.ObservabilityRunDetailNode) memoryCaptureContent {
	attrs := decodeRawObject(node.Attributes)
	return memoryCaptureContent{
		MemoryID:      firstNonEmpty(node.MemoryID, stringField(attrs, "memoryId")),
		RequestedMode: stringField(attrs, "requestedMode"),
		Disposition:   stringField(attrs, "disposition"),
		Outcome:       stringField(attrs, "outcome"),
	}
}

type sequenceContent struct {
	Label, Summary string
}

func projectSequence(node api.ObservabilityRunDetailNode) sequenceContent {
	switch node.Family {
	case "flow":
		steps := make([]string, 0, len(node.Children))
		for _, child := range node.Children {
			if child.Primitive == "flow.step" {
				steps = append(steps, firstNonEmpty(child.StepID, child.Display.Label, child.Name))
			}
		}
		if len(steps) > 0 {
			return sequenceContent{Label: "steps", Summary: strings.Join(steps, " → ")}
		}
	case "agent":
		tools, generations := 0, 0
		for _, child := range node.Children {
			switch child.Family {
			case "tool":
				tools++
			case "generation":
				generations++
			}
		}
		if len(node.Children) > 0 {
			return sequenceContent{
				Label:   "loop",
				Summary: fmt.Sprintf("%d activities · %d tools · %d generations", len(node.Children), tools, generations),
			}
		}
	}
	return sequenceContent{}
}

func childMemberRuns(detail api.ObservabilityRunDetail) []observability.OperationRunDetail {
	children := make([]observability.OperationRunDetail, 0, len(detail.MemberRuns))
	for _, member := range detail.MemberRuns {
		if member.Run.RunID != "" && member.Run.RunID != detail.Run.RunID {
			children = append(children, member)
		}
	}
	sort.SliceStable(children, func(i, j int) bool {
		return children[i].Run.StartedAt < children[j].Run.StartedAt
	})
	return children
}
