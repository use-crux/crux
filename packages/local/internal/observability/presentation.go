package observability

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

func buildPresentation(run RunSummary, spans []SpanSummary, canonicalParents map[string]string, toolRequestOwners map[string]string) presentation {
	childrenByParent := make(map[string][]SpanSummary)
	roots := make([]SpanSummary, 0)
	spanIDs := make(map[string]struct{}, len(spans))
	spansByID := make(map[string]SpanSummary, len(spans))
	for _, span := range spans {
		spanIDs[span.SpanID] = struct{}{}
		spansByID[span.SpanID] = span
	}
	for _, span := range spans {
		if span.ParentSpanID == "" {
			roots = append(roots, span)
			continue
		}
		if _, parentExists := spanIDs[span.ParentSpanID]; !parentExists {
			roots = append(roots, span)
			continue
		}
		childrenByParent[span.ParentSpanID] = append(childrenByParent[span.ParentSpanID], span)
	}

	view := presentation{
		Run:         run,
		DisplayMode: "presentation",
		Spans:       make([]presentationNode, 0, len(roots)),
	}
	for _, root := range roots {
		nodes, details, counts := buildPresentationNodes(root, childrenByParent, spansByID, canonicalParents, toolRequestOwners, nil, "")
		view.Spans = append(view.Spans, nodes...)
		view.RunDetails = append(view.RunDetails, details...)
		view.Counts.Primary += counts.Primary
		view.Counts.Detail += counts.Detail
		view.Counts.Metadata += counts.Metadata
	}
	view.HiddenSpanCount = view.Counts.Detail + view.Counts.Metadata
	return view
}

func canonicalParentMap(spans []SpanSummary) map[string]string {
	parents := make(map[string]string, len(spans))
	for _, span := range spans {
		parents[span.SpanID] = span.ParentSpanID
	}
	return parents
}

func toolRequestOwnerMap(artifacts []ArtifactSummary) map[string]string {
	owners := make(map[string]string)
	for _, artifact := range artifacts {
		if artifact.Kind != "tool.request" || artifact.SpanID == "" {
			continue
		}
		toolCallID := toolCallIDFromArtifact(artifact)
		if toolCallID == "" {
			continue
		}
		if _, exists := owners[toolCallID]; !exists {
			owners[toolCallID] = artifact.SpanID
		}
	}
	return owners
}

func applyPresentationParenting(spans []SpanSummary) []SpanSummary {
	byID := make(map[string]SpanSummary, len(spans))
	for _, span := range spans {
		byID[span.SpanID] = span
	}
	out := append([]SpanSummary(nil), spans...)
	for i := range out {
		span := &out[i]
		parent, hasParent := byID[span.ParentSpanID]
		if !hasParent {
			continue
		}
		if span.Primitive == "tool.call" && parent.Family == "generation" {
			if streamParent := nearestPresentationStreamThroughGenerationAncestors(parent, byID); streamParent != "" {
				span.ParentSpanID = streamParent
			} else if agentParent := nearestPresentationAgentThroughGenerationAncestors(parent, byID); agentParent != "" {
				span.ParentSpanID = agentParent
			}
		}
		if span.Primitive == "flow.suspension" {
			if flowParent := nearestPresentationFlowParent(parent, byID); flowParent != "" {
				span.ParentSpanID = flowParent
			}
		}
	}
	return out
}

func nearestPresentationStreamThroughGenerationAncestors(span SpanSummary, byID map[string]SpanSummary) string {
	for {
		if span.Primitive == "generation.stream" {
			return span.SpanID
		}
		if span.ParentSpanID == "" {
			return ""
		}
		next, ok := byID[span.ParentSpanID]
		if !ok || next.Family != "generation" {
			return ""
		}
		span = next
	}
}

func nearestPresentationAgentThroughGenerationAncestors(span SpanSummary, byID map[string]SpanSummary) string {
	for {
		if span.ParentSpanID == "" {
			return ""
		}
		next, ok := byID[span.ParentSpanID]
		if !ok {
			return ""
		}
		if next.Family == "agent" {
			return next.SpanID
		}
		if next.Family != "generation" {
			return ""
		}
		span = next
	}
}

func nearestPresentationFlowParent(span SpanSummary, byID map[string]SpanSummary) string {
	for {
		if span.Primitive == "flow.run" {
			return span.SpanID
		}
		if span.ParentSpanID == "" {
			return ""
		}
		next, ok := byID[span.ParentSpanID]
		if !ok {
			return ""
		}
		span = next
	}
}
func buildPresentationNodes(span SpanSummary, childrenByParent map[string][]SpanSummary, spansByID map[string]SpanSummary, canonicalParents map[string]string, toolRequestOwners map[string]string, pending []presentationDetail, visualParentSpanID string) ([]presentationNode, []presentationDetail, presentationViewCounts) {
	display := presentationDisplay(span, spansByID)
	children := childrenByParent[span.SpanID]
	if display == "primary" && isRedundantConvexAgentStreamContainer(span, children) {
		display = "detail"
	}
	counts := presentationViewCounts{}
	switch display {
	case "primary":
		counts.Primary++
	case "metadata":
		counts.Metadata++
	default:
		counts.Detail++
	}

	if display != "primary" {
		nextPending := appendPresentationDetail(pending, span, display)
		visible, leafDetails, childCounts := buildPresentationChildNodes(children, childrenByParent, spansByID, canonicalParents, toolRequestOwners, nextPending, visualParentSpanID)
		counts.Primary += childCounts.Primary
		counts.Detail += childCounts.Detail
		counts.Metadata += childCounts.Metadata
		return visible, leafDetails, counts
	}

	span.ParentSpanID = visualParentSpanID
	node := presentationNode{
		SpanSummary:           span,
		Display:               "primary",
		CanonicalParentSpanID: canonicalParents[span.SpanID],
		OrderAfterSpanID:      presentationOrderAfterSpanID(span, toolRequestOwners),
		Details:               append([]presentationDetail(nil), pending...),
		Children:              make([]presentationNode, 0, len(children)),
	}
	childNodes, childDetails, childCounts := buildPresentationChildNodes(children, childrenByParent, spansByID, canonicalParents, toolRequestOwners, nil, span.SpanID)
	node.Children = append(node.Children, childNodes...)
	node.Details = append(node.Details, childDetails...)
	counts.Primary += childCounts.Primary
	counts.Detail += childCounts.Detail
	counts.Metadata += childCounts.Metadata
	if isTransitionSpan(span) && len(node.Children) > 0 {
		siblings := append([]presentationNode{node}, node.Children...)
		siblings[0].Children = nil
		return siblings, nil, counts
	}
	return []presentationNode{node}, nil, counts
}

func buildPresentationChildNodes(children []SpanSummary, childrenByParent map[string][]SpanSummary, spansByID map[string]SpanSummary, canonicalParents map[string]string, toolRequestOwners map[string]string, pending []presentationDetail, visualParentSpanID string) ([]presentationNode, []presentationDetail, presentationViewCounts) {
	var visible []presentationNode
	var leafDetails []presentationDetail
	counts := presentationViewCounts{}
	pendingSiblings := append([]presentationDetail(nil), pending...)

	for _, child := range children {
		childNodes, childDetails, childCounts := buildPresentationNodes(child, childrenByParent, spansByID, canonicalParents, toolRequestOwners, nil, visualParentSpanID)
		counts.Primary += childCounts.Primary
		counts.Detail += childCounts.Detail
		counts.Metadata += childCounts.Metadata

		if len(childNodes) == 0 {
			pendingSiblings = append(pendingSiblings, childDetails...)
			continue
		}

		if len(pendingSiblings) > 0 {
			childNodes[0].Details = append(append([]presentationDetail(nil), pendingSiblings...), childNodes[0].Details...)
		}
		visible = append(visible, childNodes...)
		pendingSiblings = nil
	}

	sortPresentationNodesByStart(visible)
	leafDetails = append(leafDetails, pendingSiblings...)
	return visible, leafDetails, counts
}

func presentationOrderAfterSpanID(span SpanSummary, toolRequestOwners map[string]string) string {
	if span.Primitive != "tool.call" {
		return ""
	}
	toolCallID := toolCallIDFromSpan(span)
	if toolCallID == "" {
		return ""
	}
	return toolRequestOwners[toolCallID]
}

func sortPresentationNodesByStart(nodes []presentationNode) {
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].OrderAfterSpanID == nodes[j].SpanID {
			return false
		}
		if nodes[j].OrderAfterSpanID == nodes[i].SpanID {
			return true
		}
		if nodes[i].CanonicalParentSpanID == nodes[j].SpanID {
			return false
		}
		if nodes[j].CanonicalParentSpanID == nodes[i].SpanID {
			return true
		}
		left := nodes[i].StartedAt
		right := nodes[j].StartedAt
		if left == "" || right == "" || left == right {
			return nodes[i].SpanID < nodes[j].SpanID
		}
		leftTime, leftErr := time.Parse(time.RFC3339Nano, left)
		rightTime, rightErr := time.Parse(time.RFC3339Nano, right)
		if leftErr != nil || rightErr != nil {
			return left < right
		}
		return leftTime.Before(rightTime)
	})
}

func isRedundantConvexAgentStreamContainer(span SpanSummary, children []SpanSummary) bool {
	if span.Primitive != "generation.stream" {
		return false
	}
	if len(children) != 1 {
		return false
	}
	if rawMessageHasValue(span.Metrics) {
		return false
	}
	for _, child := range children {
		if isConvexAgentStepGeneration(child) {
			return true
		}
	}
	return false
}

func rawMessageHasValue(value json.RawMessage) bool {
	return len(value) > 0 && string(value) != "null"
}

func isConvexAgentStepGeneration(span SpanSummary) bool {
	if span.Primitive != "generation.call" {
		return false
	}
	if stringAttribute(span.Attributes, "source") == "convex.agent.step" {
		return true
	}
	if _, ok := numericAttribute(span.Attributes, "stepNumber"); ok {
		return true
	}
	return strings.Contains(normalizeDisplayName(span.Name), "step-")
}

func appendPresentationDetail(details []presentationDetail, span SpanSummary, display string) []presentationDetail {
	next := append([]presentationDetail(nil), details...)
	next = append(next, presentationDetail{
		SpanSummary: span,
		Display:     display,
	})
	return next
}

func presentationDisplay(span SpanSummary, spansByID map[string]SpanSummary) string {
	if override := presentationDisplayOverride(span.Attributes); override != "" {
		return override
	}
	if span.Family == "" || span.Primitive == "" {
		return "detail"
	}
	if span.Primitive == "flow.suspension" {
		return "primary"
	}
	if span.Primitive == "retrieval.stage" && span.Status == "ok" {
		return "detail"
	}
	if isContextualInputDetailSpan(span, spansByID) {
		return "detail"
	}
	if isQuietGovernanceSpan(span) {
		return "detail"
	}
	switch span.Primitive {
	case "context.resolve", "context.predicate", "context.cache", "prompt.resolve", "prompt.budget", "routing.router", "routing.cascade", "cache.lookup", "cost.record":
		return "detail"
	}
	switch span.Family {
	case "context", "prompt", "routing", "cache", "cost":
		return "detail"
	default:
		return "primary"
	}
}

func isContextualInputDetailSpan(span SpanSummary, spansByID map[string]SpanSummary) bool {
	if span.ParentSpanID == "" {
		return false
	}
	switch span.Family {
	case "embedding":
		return hasPresentationAncestorFamily(span.ParentSpanID, spansByID, "retrieval", "memory") ||
			hasPresentationAncestorFamilyBeforeOperationBoundary(span.ParentSpanID, spansByID, "generation", "context", "prompt")
	case "memory":
		return hasPresentationAncestorFamily(span.ParentSpanID, spansByID, "retrieval", "memory") ||
			hasPresentationAncestorFamilyBeforeOperationBoundary(span.ParentSpanID, spansByID, "generation", "context", "prompt")
	case "retrieval":
		return hasPresentationAncestorFamily(span.ParentSpanID, spansByID, "retrieval") ||
			hasPresentationAncestorFamilyBeforeOperationBoundary(span.ParentSpanID, spansByID, "generation", "context", "prompt")
	default:
		return false
	}
}

func hasPresentationAncestorFamily(parentSpanID string, spansByID map[string]SpanSummary, families ...string) bool {
	wanted := make(map[string]struct{}, len(families))
	for _, family := range families {
		wanted[family] = struct{}{}
	}
	seen := map[string]struct{}{}
	for parentSpanID != "" {
		if _, loop := seen[parentSpanID]; loop {
			return false
		}
		seen[parentSpanID] = struct{}{}
		parent, ok := spansByID[parentSpanID]
		if !ok {
			return false
		}
		if _, ok := wanted[parent.Family]; ok {
			return true
		}
		parentSpanID = parent.ParentSpanID
	}
	return false
}

func hasPresentationAncestorFamilyBeforeOperationBoundary(parentSpanID string, spansByID map[string]SpanSummary, families ...string) bool {
	wanted := make(map[string]struct{}, len(families))
	for _, family := range families {
		wanted[family] = struct{}{}
	}
	seen := map[string]struct{}{}
	for parentSpanID != "" {
		if _, loop := seen[parentSpanID]; loop {
			return false
		}
		seen[parentSpanID] = struct{}{}
		parent, ok := spansByID[parentSpanID]
		if !ok {
			return false
		}
		if _, ok := wanted[parent.Family]; ok {
			return true
		}
		if isPresentationOperationBoundary(parent) {
			return false
		}
		parentSpanID = parent.ParentSpanID
	}
	return false
}

func isPresentationOperationBoundary(span SpanSummary) bool {
	switch span.Family {
	case "agent", "tool", "flow", "composition", "handoff", "delegate":
		return true
	default:
		return false
	}
}

func isTransitionSpan(span SpanSummary) bool {
	return span.Family == "handoff" || span.Family == "delegate" || span.Primitive == "handoff.prepare" || span.Primitive == "delegate.invoke"
}

func isQuietGovernanceSpan(span SpanSummary) bool {
	switch span.Family {
	case "constraint", "guardrail", "citation", "scoring", "security":
	default:
		return false
	}
	if span.Primitive == "constraint.retry" {
		return false
	}
	if span.Status != "ok" && span.Status != "skipped" {
		return false
	}
	return !governanceChangedExecution(span.Attributes)
}

func governanceChangedExecution(attributes json.RawMessage) bool {
	if len(attributes) == 0 {
		return false
	}
	var decoded map[string]any
	if err := json.Unmarshal(attributes, &decoded); err != nil {
		return false
	}
	for _, key := range []string{"blocked", "retried", "transformed", "redacted", "rerouted", "changedModel", "changedTool", "remediation"} {
		if value, ok := decoded[key]; ok && truthy(value) {
			return true
		}
	}
	return false
}

func truthy(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != "" && v != "false"
	case float64:
		return v != 0
	default:
		return value != nil
	}
}

func presentationDisplayOverride(attributes json.RawMessage) string {
	if len(attributes) == 0 {
		return ""
	}
	var decoded struct {
		Presentation struct {
			Display string `json:"display"`
		} `json:"presentation"`
	}
	if err := json.Unmarshal(attributes, &decoded); err != nil {
		return ""
	}
	switch decoded.Presentation.Display {
	case "primary", "detail", "metadata":
		return decoded.Presentation.Display
	default:
		return ""
	}
}
