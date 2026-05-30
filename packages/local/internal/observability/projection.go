package observability

import "time"

// ProjectionOptions carries explicit inputs for deterministic read-model derivation.
type ProjectionOptions struct {
	Now time.Time
}

// DefaultProjectionOptions returns production projection inputs.
func DefaultProjectionOptions() ProjectionOptions {
	return ProjectionOptions{Now: time.Now()}
}

func (opts ProjectionOptions) normalized() ProjectionOptions {
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}
	return opts
}

// ProjectRunDetail derives the backend-owned run detail read model from a canonical graph.
func ProjectRunDetail(graph Graph, opts ProjectionOptions) RunDetail {
	opts = opts.normalized()
	presentationGraph := reconciledPresentationGraphAt(graph, opts.Now)
	diagnostics := runDetailDiagnosticsAt(presentationGraph, opts.Now)
	canonicalParents := canonicalParentMap(presentationGraph.Spans)
	toolRequestOwners := toolRequestOwnerMap(graph.Artifacts)
	presentationGraph.Spans = applyPresentationParenting(presentationGraph.Spans)
	presentation := buildPresentation(presentationGraph.Run, presentationGraph.Spans, canonicalParents, toolRequestOwners)

	eventsBySpan := make(map[string][]SpanEventSummary)
	for _, event := range graph.Events {
		eventsBySpan[event.SpanID] = append(eventsBySpan[event.SpanID], event)
	}
	artifactsBySpan := make(map[string][]ArtifactSummary)
	artifactsByID := make(map[string]ArtifactSummary)
	for _, artifact := range graph.Artifacts {
		artifactsBySpan[artifact.SpanID] = append(artifactsBySpan[artifact.SpanID], artifact)
		artifactsByID[artifact.ArtifactID] = artifact
	}
	edgesBySpan := make(map[string][]EdgeSummary)
	for _, edge := range graph.Edges {
		if edge.From.Kind == "span" {
			edgesBySpan[edge.From.ID] = append(edgesBySpan[edge.From.ID], edge)
		}
		if edge.To.Kind == "span" && edge.To.ID != edge.From.ID {
			edgesBySpan[edge.To.ID] = append(edgesBySpan[edge.To.ID], edge)
		}
		if edge.EdgeType == "consumed" && edge.From.Kind == "artifact" && edge.To.Kind == "span" {
			if artifact, ok := artifactsByID[edge.From.ID]; ok && artifact.Kind == "context" {
				artifactsBySpan[edge.To.ID] = appendMissingArtifacts(artifactsBySpan[edge.To.ID], artifact)
			}
		}
	}

	spanIndex := make(map[string]RunDetailPlacement)
	root := buildRunDetailRoot(presentation, presentationGraph, eventsBySpan, artifactsBySpan, edgesBySpan, canonicalParents, spanIndex, opts.Now)
	applySemanticDetailOwnership(&root, graph, spanIndex)
	applyRunDetailRollups(&root)
	applyRunDetailStatusRollups(&root)
	toolRequestsByCallID := buildToolRequestIndex(graph.Artifacts)
	applyRunDetailInspection(&root, toolRequestsByCallID)
	resetRunDetailIndex(&root, spanIndex)
	rows := flattenRunDetailRows(root)
	facets := buildRunDetailFacets(graph)
	attachedDetails := 0
	for _, placement := range spanIndex {
		if placement.Placement == "detail" || placement.Placement == "runDetail" {
			attachedDetails++
		}
	}

	return RunDetail{
		SchemaVersion: SchemaVersion,
		Run:           presentationGraph.Run,
		Root:          root,
		Rows:          rows,
		SpanIndex:     spanIndex,
		Facets:        facets,
		Diagnostics:   diagnostics,
		Counts: RunDetailCounts{
			Primary:         presentation.Counts.Primary,
			Detail:          presentation.Counts.Detail,
			Metadata:        presentation.Counts.Metadata,
			AttachedDetails: attachedDetails,
		},
	}
}
