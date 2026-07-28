package observability

import "encoding/json"

type redactionRecordCoordinates struct {
	SpanID     string  `json:"spanId"`
	ArtifactID string  `json:"artifactId"`
	EdgeID     string  `json:"edgeId"`
	From       NodeRef `json:"from"`
}

type redactionProjectionEvidence struct {
	run       *ObservabilityRedactionEvidence
	bySpan    map[string]*ObservabilityRedactionEvidence
	artifacts map[string]*ObservabilityRedactionEvidence
	edges     map[string]redactionEdgeEvidence
}

type redactionEdgeEvidence struct {
	from      NodeRef
	redaction *ObservabilityRedactionEvidence
}

// applyRunDetailRedaction projects runtime-owned record evidence after semantic
// placement is final. It never inspects captured payload values.
func applyRunDetailRedaction(
	root *RunDetailNode,
	graph Graph,
	spanIndex map[string]RunDetailPlacement,
) *ObservabilityRedactionEvidence {
	return applyRunDetailRedactionProjection(
		root,
		collectRedactionProjectionEvidence(graph.Records),
		spanIndex,
	)
}

func applyRunDetailRedactionProjection(
	root *RunDetailNode,
	projected redactionProjectionEvidence,
	spanIndex map[string]RunDetailPlacement,
) *ObservabilityRedactionEvidence {
	attachArtifactRedaction(root, projected.artifacts)
	applyOwnedRedaction(root, projected.bySpan)

	for _, edge := range projected.edges {
		if edge.from.Kind == "span" {
			if applyRedactionAtPlacement(root, spanIndex[edge.from.ID], edge.redaction) {
				continue
			}
		}
		projected.run = mergeRedactionEvidence(projected.run, edge.redaction)
	}
	root.Redaction = mergeRedactionEvidence(root.Redaction, projected.run)

	wholeRun := collectRunDetailSubtreeRedaction(root)
	root.Redaction = mergeRedactionEvidence(root.Redaction, wholeRun)
	return root.Redaction
}

func collectRedactionProjectionEvidence(records []StoredRecord) redactionProjectionEvidence {
	projected := newRedactionProjectionEvidence()
	for _, stored := range records {
		var record Record
		if err := json.Unmarshal([]byte(stored.PayloadJSON), &record); err != nil ||
			record.Privacy == nil {
			continue
		}
		var coordinates redactionRecordCoordinates
		if err := json.Unmarshal([]byte(stored.PayloadJSON), &coordinates); err != nil {
			continue
		}
		addRedactionProjectionEvidence(
			&projected,
			record.Type,
			coordinates,
			&record.Privacy.Redaction,
		)
	}
	return projected
}

func newRedactionProjectionEvidence() redactionProjectionEvidence {
	return redactionProjectionEvidence{
		bySpan:    make(map[string]*ObservabilityRedactionEvidence),
		artifacts: make(map[string]*ObservabilityRedactionEvidence),
		edges:     make(map[string]redactionEdgeEvidence),
	}
}

func addRedactionProjectionEvidence(
	projected *redactionProjectionEvidence,
	recordType RecordType,
	coordinates redactionRecordCoordinates,
	redaction *ObservabilityRedactionEvidence,
) {
	switch recordType {
	case RecordRunStart, RecordRunSuspend, RecordRunResume, RecordRunEnd:
		projected.run = mergeRedactionEvidence(projected.run, redaction)
	case RecordSpanStart, RecordSpanEnd, RecordSpan, RecordSpanEvent:
		projected.bySpan[coordinates.SpanID] = mergeRedactionEvidence(
			projected.bySpan[coordinates.SpanID],
			redaction,
		)
	case RecordArtifact:
		projected.artifacts[coordinates.ArtifactID] = mergeRedactionEvidence(
			projected.artifacts[coordinates.ArtifactID],
			redaction,
		)
	case RecordEdge:
		previous := projected.edges[coordinates.EdgeID]
		projected.edges[coordinates.EdgeID] = redactionEdgeEvidence{
			from:      coordinates.From,
			redaction: mergeRedactionEvidence(previous.redaction, redaction),
		}
	}
}

func attachArtifactRedaction(
	node *RunDetailNode,
	byArtifactID map[string]*ObservabilityRedactionEvidence,
) {
	for index := range node.Artifacts {
		node.Artifacts[index].Redaction = byArtifactID[node.Artifacts[index].ArtifactID]
	}
	for detailIndex := range node.Details {
		for artifactIndex := range node.Details[detailIndex].Artifacts {
			artifact := &node.Details[detailIndex].Artifacts[artifactIndex]
			artifact.Redaction = byArtifactID[artifact.ArtifactID]
		}
	}
	for index := range node.Children {
		attachArtifactRedaction(&node.Children[index], byArtifactID)
	}
}

func applyOwnedRedaction(
	node *RunDetailNode,
	bySpanID map[string]*ObservabilityRedactionEvidence,
) {
	node.Redaction = mergeRedactionEvidence(
		node.Redaction,
		bySpanID[node.SpanID],
		artifactListRedaction(node.Artifacts),
	)
	for index := range node.Details {
		detail := &node.Details[index]
		detail.Redaction = mergeRedactionEvidence(
			detail.Redaction,
			bySpanID[detail.SpanID],
			artifactListRedaction(detail.Artifacts),
		)
	}
	for index := range node.Children {
		applyOwnedRedaction(&node.Children[index], bySpanID)
	}
}

func artifactListRedaction(artifacts []ArtifactSummary) *ObservabilityRedactionEvidence {
	var redaction *ObservabilityRedactionEvidence
	for index := range artifacts {
		redaction = mergeRedactionEvidence(redaction, artifacts[index].Redaction)
	}
	return redaction
}

func applyRedactionAtPlacement(
	root *RunDetailNode,
	placement RunDetailPlacement,
	redaction *ObservabilityRedactionEvidence,
) bool {
	switch placement.Placement {
	case "node":
		if node := findRunDetailNodeByID(root, placement.NodeID); node != nil {
			node.Redaction = mergeRedactionEvidence(node.Redaction, redaction)
			return true
		}
	case "detail", "runDetail":
		if detail := findRunDetailDetailBySpanID(root, placementPathSpanID(placement)); detail != nil {
			detail.Redaction = mergeRedactionEvidence(detail.Redaction, redaction)
			return true
		}
	}
	return false
}

func placementPathSpanID(placement RunDetailPlacement) string {
	for index := len(placement.Path) - 1; index >= 0; index-- {
		if len(placement.Path[index]) > len("detail:") &&
			placement.Path[index][:len("detail:")] == "detail:" {
			return placement.Path[index][len("detail:"):]
		}
	}
	return ""
}

func findRunDetailNodeByID(node *RunDetailNode, id string) *RunDetailNode {
	if node.ID == id {
		return node
	}
	for index := range node.Children {
		if found := findRunDetailNodeByID(&node.Children[index], id); found != nil {
			return found
		}
	}
	return nil
}

func findRunDetailDetailBySpanID(node *RunDetailNode, spanID string) *RunDetailDetail {
	for index := range node.Details {
		if node.Details[index].SpanID == spanID {
			return &node.Details[index]
		}
	}
	for index := range node.Children {
		if found := findRunDetailDetailBySpanID(&node.Children[index], spanID); found != nil {
			return found
		}
	}
	return nil
}

func collectRunDetailSubtreeRedaction(node *RunDetailNode) *ObservabilityRedactionEvidence {
	redaction := node.Redaction
	for index := range node.Details {
		redaction = mergeRedactionEvidence(redaction, node.Details[index].Redaction)
	}
	for index := range node.Children {
		redaction = mergeRedactionEvidence(redaction, collectRunDetailSubtreeRedaction(&node.Children[index]))
	}
	return redaction
}
