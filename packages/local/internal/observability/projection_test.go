package observability

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailUsesExplicitProjectionClock(t *testing.T) {
	started := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_clock",
			TraceID:       "trace_clock",
			Name:          "clocked run",
			RootPrimitive: "agent.run",
			Status:        "running",
			StartedAt:     started.Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{{
			RunID:     "run_clock",
			TraceID:   "trace_clock",
			SpanID:    "span_agent",
			Family:    "agent",
			Primitive: "agent.run",
			Name:      "clocked run",
			Status:    "running",
			StartedAt: started.Format(time.RFC3339Nano),
		}},
	}

	active := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(10 * time.Second)})
	if active.Run.Status != "running" || active.Root.Status != "running" {
		t.Fatalf("active statuses = %q/%q, want running/running", active.Run.Status, active.Root.Status)
	}

	stale := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(61 * time.Second)})
	if stale.Run.Status != "incomplete" || stale.Root.Status != "incomplete" {
		t.Fatalf("stale statuses = %q/%q, want incomplete/incomplete", stale.Run.Status, stale.Root.Status)
	}
	if stale.Run.DurationMs != 61000 || stale.Root.DurationMs != 61000 {
		t.Fatalf("stale durations = %f/%f, want 61000/61000", stale.Run.DurationMs, stale.Root.DurationMs)
	}
}

func TestProjectRunDetailUsesConvexBoundaryLeaseAsActiveWork(t *testing.T) {
	started := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)
	leaseExpiresAt := started.Add(11 * time.Minute)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_boundary_lease_active",
			TraceID:       "trace_boundary_lease_active",
			Name:          "Support Agent",
			RootPrimitive: "agent.run",
			Status:        "running",
			StartedAt:     started.Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{
			{
				RunID:     "run_boundary_lease_active",
				TraceID:   "trace_boundary_lease_active",
				SpanID:    "span_agent",
				Family:    "agent",
				Primitive: "agent.run",
				Name:      "Support Agent",
				Status:    "running",
				StartedAt: started.Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_boundary_lease_active",
				TraceID:      "trace_boundary_lease_active",
				SpanID:       "span_boundary",
				ParentSpanID: "span_agent",
				Family:       "runtime",
				Primitive:    "runtime.convex.action",
				Name:         "research",
				Status:       "running",
				StartedAt:    started.Add(time.Second).Format(time.RFC3339Nano),
			},
		},
		Events: []SpanEventSummary{{
			RunID:     "run_boundary_lease_active",
			TraceID:   "trace_boundary_lease_active",
			SpanID:    "span_boundary",
			Name:      "runtime.convex.boundary.requested",
			Timestamp: started.Add(time.Second).Format(time.RFC3339Nano),
			Attributes: json.RawMessage(
				`{"leaseExpiresAt":"` + leaseExpiresAt.Format(time.RFC3339Nano) + `"}`,
			),
		}},
	}

	active := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Minute)})
	if active.Run.Status != "running" || active.Root.Status != "running" {
		t.Fatalf("active statuses = %q/%q, want running/running", active.Run.Status, active.Root.Status)
	}

	expired := ProjectRunDetail(graph, ProjectionOptions{Now: leaseExpiresAt.Add(time.Second)})
	if expired.Run.Status != "stale" || expired.Root.Status != "stale" {
		t.Fatalf("expired statuses = %q/%q, want stale/stale", expired.Run.Status, expired.Root.Status)
	}
}

func TestProjectRunDetailBuildsExactGenerationRequest(t *testing.T) {
	started := time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_request_exact",
			TraceID:       "trace_request_exact",
			Name:          "support reply",
			RootPrimitive: "generation.call",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{{
			RunID:      "run_request_exact",
			TraceID:    "trace_request_exact",
			SpanID:     "span_generation",
			Family:     "generation",
			Primitive:  "generation.call",
			Name:       "generate support reply",
			Status:     "ok",
			StartedAt:  started.Format(time.RFC3339Nano),
			EndedAt:    started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs: 1000,
			PromptID:   "support.reply",
		}},
		Artifacts: []ArtifactSummary{
			{
				ArtifactID:  "artifact_messages",
				RunID:       "run_request_exact",
				TraceID:     "trace_request_exact",
				SpanID:      "span_generation",
				Kind:        "messages",
				CreatedAt:   started.Format(time.RFC3339Nano),
				ContentType: "application/json",
				Encoding:    "json",
				Preview: json.RawMessage(`{
					"input":{"question":"refund?"},
					"system":"Base.\n\nRefund policy.",
					"systemBlocks":[
						{"source":"prompt","text":"Base."},
						{"source":"context:refund","text":"Refund policy.","artifactId":"artifact_context"}
					],
					"messages":[{"role":"user","content":"refund?"}],
					"toolNames":["lookupPolicy","draftReply"]
				}`),
			},
			{
				ArtifactID:  "artifact_context",
				RunID:       "run_request_exact",
				TraceID:     "trace_request_exact",
				SpanID:      "span_prompt_resolve",
				Kind:        "context.contribution",
				CreatedAt:   started.Format(time.RFC3339Nano),
				ContentType: "application/json",
				Encoding:    "json",
				Preview: json.RawMessage(`{
					"kind":"context.contribution",
					"state":"active",
					"included":true,
					"sourceId":"context:refund",
					"injectableKind":"context",
					"injects":["system","tools"],
					"injectedTools":["lookupPolicy"],
					"priority":50,
					"tokens":3,
					"text":"Refund policy."
				}`),
			},
			{
				ArtifactID:  "artifact_budget",
				RunID:       "run_request_exact",
				TraceID:     "trace_request_exact",
				SpanID:      "span_prompt_resolve",
				Kind:        "prompt.budget",
				CreatedAt:   started.Format(time.RFC3339Nano),
				ContentType: "application/json",
				Encoding:    "json",
				Preview: json.RawMessage(`{
					"kind":"prompt.budget",
					"usedTokens":12,
					"totalTokens":20,
					"dropped":[{
						"kind":"context.contribution",
						"state":"dropped-budget",
						"included":false,
						"sourceId":"context:verbose",
						"injectableKind":"context",
						"reason":"token budget",
						"priority":1,
						"tokens":80
					}]
				}`),
			},
			outputArtifact("run_request_exact", "trace_request_exact", "artifact_output", "span_generation", started.Add(time.Second), "openai/gpt-5-mini", "resp_exact"),
		},
		Edges: []EdgeSummary{
			{
				EdgeID:    "edge_messages",
				RunID:     "run_request_exact",
				TraceID:   "trace_request_exact",
				EdgeType:  "consumed",
				From:      NodeRef{Kind: "span", ID: "span_generation"},
				To:        NodeRef{Kind: "artifact", ID: "artifact_messages"},
				CreatedAt: started.Format(time.RFC3339Nano),
			},
			{
				EdgeID:    "edge_context",
				RunID:     "run_request_exact",
				TraceID:   "trace_request_exact",
				EdgeType:  "consumed",
				From:      NodeRef{Kind: "artifact", ID: "artifact_context"},
				To:        NodeRef{Kind: "span", ID: "span_generation"},
				CreatedAt: started.Format(time.RFC3339Nano),
			},
			{
				EdgeID:    "edge_budget",
				RunID:     "run_request_exact",
				TraceID:   "trace_request_exact",
				EdgeType:  "consumed",
				From:      NodeRef{Kind: "artifact", ID: "artifact_budget"},
				To:        NodeRef{Kind: "span", ID: "span_generation"},
				CreatedAt: started.Format(time.RFC3339Nano),
			},
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})

	if detail.Root.Request == nil {
		t.Fatal("root request is nil")
	}
	if detail.Root.Request.Mode != "exact" {
		t.Fatalf("request mode = %q, want exact", detail.Root.Request.Mode)
	}
	if detail.Root.Request.BasePrompt == nil || detail.Root.Request.BasePrompt.Text != "Base." {
		t.Fatalf("base prompt = %#v, want Base.", detail.Root.Request.BasePrompt)
	}
	if detail.Root.Request.BasePrompt.SourceID != "support.reply" {
		t.Fatalf("base prompt source = %q, want concrete prompt id", detail.Root.Request.BasePrompt.SourceID)
	}
	if detail.Root.Model != "openai/gpt-5-mini" || detail.Root.Provider != "openai" {
		t.Fatalf("root model/provider = %q/%q, want output actual model", detail.Root.Model, detail.Root.Provider)
	}
	if detail.Root.Request.ModelSummary == nil || detail.Root.Request.ModelSummary.PrimaryModel != "openai/gpt-5-mini" {
		t.Fatalf("model summary = %#v, want output actual model", detail.Root.Request.ModelSummary)
	}
	if len(detail.Root.Request.Contributions) != 2 {
		t.Fatalf("contribution count = %d, want active + dropped", len(detail.Root.Request.Contributions))
	}
	if detail.Root.Request.Contributions[0].SourceID != "context:refund" || detail.Root.Request.Contributions[0].State != "active" {
		t.Fatalf("first contribution = %#v, want active refund context", detail.Root.Request.Contributions[0])
	}
	if detail.Root.Request.Contributions[1].SourceID != "context:verbose" || detail.Root.Request.Contributions[1].State != "dropped-budget" {
		t.Fatalf("second contribution = %#v, want dropped verbose context", detail.Root.Request.Contributions[1])
	}
	if len(detail.Root.Request.Tools) != 2 {
		t.Fatalf("tool count = %d, want 2", len(detail.Root.Request.Tools))
	}
	if detail.Root.Request.Tools[0].Name != "lookupPolicy" || detail.Root.Request.Tools[0].Origin != "injected" {
		t.Fatalf("first tool = %#v, want injected lookupPolicy", detail.Root.Request.Tools[0])
	}
	if detail.Root.Request.Tools[1].Name != "draftReply" || detail.Root.Request.Tools[1].Origin != "request" {
		t.Fatalf("second tool = %#v, want request draftReply", detail.Root.Request.Tools[1])
	}
}

func TestProjectRunDetailFoldsRoutingDecisionOntoSelectedGeneration(t *testing.T) {
	started := time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_routed_generation",
			TraceID:       "trace_routed_generation",
			Name:          "routed answer",
			RootPrimitive: "routing.router",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_routed_generation",
				TraceID:    "trace_routed_generation",
				SpanID:     "span_router",
				Family:     "routing",
				Primitive:  "routing.router",
				Name:       "router.resolve",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(10 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs: 10,
				Attributes: json.RawMessage(`{"selectedModel":"openai/gpt-5-mini","classifiedAs":"fast"}`),
			},
			{
				RunID:        "run_routed_generation",
				TraceID:      "trace_routed_generation",
				SpanID:       "span_generation",
				ParentSpanID: "span_router",
				Family:       "generation",
				Primitive:    "generation.call",
				Name:         "generate answer",
				Status:       "ok",
				StartedAt:    started.Add(20 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs:   980,
				Model:        "openai/gpt-5-mini",
				Provider:     "openai",
			},
		},
		Artifacts: []ArtifactSummary{{
			ArtifactID:  "artifact_routing",
			RunID:       "run_routed_generation",
			TraceID:     "trace_routed_generation",
			SpanID:      "span_router",
			Kind:        "routing.report",
			CreatedAt:   started.Add(5 * time.Millisecond).Format(time.RFC3339Nano),
			ContentType: "application/json",
			Encoding:    "json",
			Preview:     json.RawMessage(`{"model":"openai/gpt-5-mini","trace":[{"kind":"router","classifiedAs":"fast","route":"fast","usedDefaultRoute":false,"forced":false}]}`),
		}},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	generation := findRunDetailNode(&detail.Root, "span_generation")
	if generation == nil {
		t.Fatalf("root = %#v, want selected generation visible", detail.Root)
	}
	if len(generation.Details) != 1 || generation.Details[0].SpanID != "span_router" {
		t.Fatalf("generation details = %#v, want folded router decision", generation.Details)
	}
	if generation.Details[0].Role != "decision" || generation.Details[0].Kind != "detail" {
		t.Fatalf("router detail = %#v, want decision detail", generation.Details[0])
	}
	if generation.Source.CanonicalParentSpanID != "span_router" {
		t.Fatalf("generation source = %#v, want canonical router parent preserved", generation.Source)
	}
	placement := detail.SpanIndex["span_router"]
	if placement.Placement != "detail" || placement.OwnerNodeID != generation.ID {
		t.Fatalf("router placement = %#v, want detail owned by generation", placement)
	}
}

func TestProjectRunDetailFoldsNestedAgentRoutingDecisionOntoSelectedGeneration(t *testing.T) {
	started := time.Date(2026, 6, 4, 12, 15, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_agent_routed_generation",
			TraceID:       "trace_agent_routed_generation",
			Name:          "agent routed answer",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(2 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    2000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_agent_routed_generation",
				TraceID:    "trace_agent_routed_generation",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "Support Agent",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(2 * time.Second).Format(time.RFC3339Nano),
				DurationMs: 2000,
			},
			{
				RunID:        "run_agent_routed_generation",
				TraceID:      "trace_agent_routed_generation",
				SpanID:       "span_stream",
				ParentSpanID: "span_agent",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "stream response",
				Status:       "ok",
				StartedAt:    started.Add(10 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1900 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   1890,
				Model:        "openrouter/agent-model",
				Provider:     "openrouter",
			},
			{
				RunID:        "run_agent_routed_generation",
				TraceID:      "trace_agent_routed_generation",
				SpanID:       "span_router",
				ParentSpanID: "span_stream",
				Family:       "routing",
				Primitive:    "routing.router",
				Name:         "tool flow router",
				Status:       "ok",
				StartedAt:    started.Add(200 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(220 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   20,
				Attributes:   json.RawMessage(`{"selectedModel":"anthropic/claude-4-haiku","classifiedAs":"tool-flow"}`),
			},
			{
				RunID:        "run_agent_routed_generation",
				TraceID:      "trace_agent_routed_generation",
				SpanID:       "span_nested_generation",
				ParentSpanID: "span_router",
				Family:       "generation",
				Primitive:    "generation.call",
				Name:         "generate research-planner",
				Status:       "ok",
				StartedAt:    started.Add(230 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs:   770,
				Model:        "anthropic/claude-4-haiku",
				Provider:     "anthropic",
			},
		},
		Artifacts: []ArtifactSummary{{
			ArtifactID:  "artifact_nested_routing",
			RunID:       "run_agent_routed_generation",
			TraceID:     "trace_agent_routed_generation",
			SpanID:      "span_router",
			Kind:        "routing.report",
			CreatedAt:   started.Add(210 * time.Millisecond).Format(time.RFC3339Nano),
			ContentType: "application/json",
			Encoding:    "json",
			Preview:     json.RawMessage(`{"model":"anthropic/claude-4-haiku","trace":[{"kind":"router","classifiedAs":"tool-flow","route":"tool-flow","usedDefaultRoute":false,"forced":false}]}`),
		}},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(3 * time.Second)})
	stream := findRunDetailNode(&detail.Root, "span_stream")
	if stream == nil {
		t.Fatalf("root = %#v, want agent stream child", detail.Root)
	}
	nested := findRunDetailNode(stream, "span_nested_generation")
	if nested == nil {
		t.Fatalf("stream = %#v, want nested routed generation visible", stream)
	}
	if len(nested.Details) != 1 || nested.Details[0].SpanID != "span_router" {
		t.Fatalf("nested details = %#v, want folded router decision", nested.Details)
	}
	if nested.Source.CanonicalParentSpanID != "span_router" {
		t.Fatalf("nested source = %#v, want canonical router parent preserved", nested.Source)
	}
	placement := detail.SpanIndex["span_router"]
	if placement.Placement != "detail" || placement.OwnerNodeID != nested.ID {
		t.Fatalf("nested router placement = %#v, want detail owned by nested generation", placement)
	}
}

func TestProjectRunDetailFoldsSecurityWarningsAsSafetyDetails(t *testing.T) {
	started := time.Date(2026, 6, 4, 12, 30, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_security_warning",
			TraceID:       "trace_security_warning",
			Name:          "safe answer",
			RootPrimitive: "generation.call",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_security_warning",
				TraceID:    "trace_security_warning",
				SpanID:     "span_prompt",
				Family:     "prompt",
				Primitive:  "prompt.resolve",
				Name:       "resolve safe.answer",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(15 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs: 15,
			},
			{
				RunID:        "run_security_warning",
				TraceID:      "trace_security_warning",
				SpanID:       "span_security",
				ParentSpanID: "span_prompt",
				Family:       "security",
				Primitive:    "security.warning",
				Name:         "security.warning",
				Status:       "ok",
				StartedAt:    started.Add(2 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(3 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   1,
				Attributes:   json.RawMessage(`{"promptId":"safe.answer","field":"question","pattern":"prompt-injection"}`),
			},
			{
				RunID:      "run_security_warning",
				TraceID:    "trace_security_warning",
				SpanID:     "span_generation",
				Family:     "generation",
				Primitive:  "generation.call",
				Name:       "generate safe.answer",
				Status:     "ok",
				StartedAt:  started.Add(20 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:    started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs: 980,
			},
		},
		Artifacts: []ArtifactSummary{{
			ArtifactID:  "artifact_security",
			RunID:       "run_security_warning",
			TraceID:     "trace_security_warning",
			SpanID:      "span_security",
			Kind:        "security.report",
			CreatedAt:   started.Add(3 * time.Millisecond).Format(time.RFC3339Nano),
			ContentType: "application/json",
			Encoding:    "json",
			Preview:     json.RawMessage(`{"kind":"security.report","severity":"warn","action":"warn"}`),
		}},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	if findRunDetailNode(&detail.Root, "span_security") != nil {
		t.Fatalf("security warning should not be a primary node: %#v", detail.Root)
	}
	security := findRunDetailDetail(&detail.Root, "span_security")
	if security == nil {
		t.Fatalf("root = %#v, want security warning folded as detail", detail.Root)
	}
	if security.Kind != "security" || security.Role != "guard" {
		t.Fatalf("security detail = %#v, want security guard detail", security)
	}
	if len(security.Inspection["safety"]) == 0 {
		t.Fatalf("security inspection = %#v, want safety report", security.Inspection)
	}
	placement := detail.SpanIndex["span_security"]
	if placement.Placement != "detail" {
		t.Fatalf("security placement = %#v, want detail", placement)
	}
}

func TestProjectRunDetailOrdersAmbientContributionsDeterministically(t *testing.T) {
	started := time.Date(2026, 6, 3, 10, 30, 0, 0, time.UTC)
	generation := requestGenerationSpan("run_request_order", "trace_request_order", "span_generation", "span_agent", "agent turn", started.Add(time.Second), "agent.prompt")
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_request_order",
			TraceID:       "trace_request_order",
			Name:          "ordered agent",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(2 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    2000,
		},
		Spans: []SpanSummary{
			{
				RunID:     "run_request_order",
				TraceID:   "trace_request_order",
				SpanID:    "span_agent",
				Family:    "agent",
				Primitive: "agent.run",
				Name:      "ordered agent",
				Status:    "ok",
				StartedAt: started.Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_request_order",
				TraceID:      "trace_request_order",
				SpanID:       "span_context_beta",
				ParentSpanID: "span_agent",
				Family:       "context",
				Primitive:    "context.resolve",
				Name:         "context:beta",
				Status:       "ok",
				StartedAt:    started.Add(200 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_request_order",
				TraceID:      "trace_request_order",
				SpanID:       "span_context_alpha",
				ParentSpanID: "span_agent",
				Family:       "context",
				Primitive:    "context.resolve",
				Name:         "context:alpha",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
			},
			generation,
		},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact("run_request_order", "trace_request_order", "artifact_messages", "span_generation", started.Add(time.Second), "Base.", "", ""),
			requestContextArtifact("run_request_order", "trace_request_order", "artifact_beta", "span_context_beta", started.Add(200*time.Millisecond), "context:beta", "Beta."),
			requestContextArtifact("run_request_order", "trace_request_order", "artifact_alpha", "span_context_alpha", started.Add(100*time.Millisecond), "context:alpha", "Alpha."),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_request_order", "trace_request_order", "edge_messages", "span_generation", "artifact_messages", started.Add(time.Second)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(3 * time.Second)})
	if detail.Root.Request == nil {
		t.Fatal("root request is nil")
	}
	if len(detail.Root.Request.Contributions) != 2 {
		t.Fatalf("contribution count = %d, want 2", len(detail.Root.Request.Contributions))
	}
	if detail.Root.Request.Contributions[0].SourceID != "context:alpha" || detail.Root.Request.Contributions[1].SourceID != "context:beta" {
		t.Fatalf("contributions = %#v, want stable created-at order", detail.Root.Request.Contributions)
	}
}

func TestProjectRunDetailBuildsAggregateAgentRequestFromFinalGeneration(t *testing.T) {
	started := time.Date(2026, 6, 3, 11, 0, 0, 0, time.UTC)
	firstTurn := requestGenerationSpan("run_request_agent", "trace_request_agent", "span_first", "span_agent", "first turn", started.Add(time.Second), "agent.plan")
	firstTurn.Attributes = json.RawMessage(`{"actualModelId":"anthropic/claude-sonnet-4","provider":"openrouter"}`)
	finalTurn := requestGenerationSpan("run_request_agent", "trace_request_agent", "span_final", "span_agent", "final turn", started.Add(2*time.Second), "agent.final")
	finalTurn.Attributes = json.RawMessage(`{"selectedModel":"openai/gpt-5-mini"}`)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_request_agent",
			TraceID:       "trace_request_agent",
			Name:          "agent run",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(3 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    3000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_request_agent",
				TraceID:    "trace_request_agent",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "agent run",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(3 * time.Second).Format(time.RFC3339Nano),
				DurationMs: 3000,
			},
			firstTurn,
			finalTurn,
		},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact("run_request_agent", "trace_request_agent", "artifact_first_messages", "span_first", started.Add(time.Second), "First base.", "context:first", "artifact_first_context"),
			requestContextArtifact("run_request_agent", "trace_request_agent", "artifact_first_context", "span_first", started.Add(time.Second), "context:first", "First context."),
			requestMessagesArtifact("run_request_agent", "trace_request_agent", "artifact_final_messages", "span_final", started.Add(2*time.Second), "Final base.", "context:final", "artifact_final_context"),
			requestContextArtifact("run_request_agent", "trace_request_agent", "artifact_final_context", "span_final", started.Add(2*time.Second), "context:final", "Final context."),
			outputArtifact("run_request_agent", "trace_request_agent", "artifact_final_output", "span_final", started.Add(2500*time.Millisecond), "openai/gpt-5-mini-2026-05-01", "resp_final"),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_request_agent", "trace_request_agent", "edge_first_messages", "span_first", "artifact_first_messages", started.Add(time.Second)),
			requestConsumedContextEdge("run_request_agent", "trace_request_agent", "edge_first_context", "artifact_first_context", "span_first", started.Add(time.Second)),
			requestConsumedEdge("run_request_agent", "trace_request_agent", "edge_final_messages", "span_final", "artifact_final_messages", started.Add(2*time.Second)),
			requestConsumedContextEdge("run_request_agent", "trace_request_agent", "edge_final_context", "artifact_final_context", "span_final", started.Add(2*time.Second)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(4 * time.Second)})

	if detail.Root.Request == nil {
		t.Fatal("agent request is nil")
	}
	if detail.Root.Request.Mode != "aggregate" {
		t.Fatalf("agent request mode = %q, want aggregate", detail.Root.Request.Mode)
	}
	if detail.Root.Request.Representative == nil || detail.Root.Request.Representative.SpanID != "span_final" {
		t.Fatalf("representative = %#v, want final generation", detail.Root.Request.Representative)
	}
	if detail.Root.Request.BasePrompt == nil || detail.Root.Request.BasePrompt.Text != "Final base." {
		t.Fatalf("agent representative base prompt = %#v, want Final base.", detail.Root.Request.BasePrompt)
	}
	if len(detail.Root.Request.Turns) != 2 {
		t.Fatalf("turn count = %d, want 2", len(detail.Root.Request.Turns))
	}
	if detail.Root.Request.Turns[0].SpanID != "span_first" || detail.Root.Request.Turns[1].SpanID != "span_final" {
		t.Fatalf("turns = %#v, want first then final", detail.Root.Request.Turns)
	}
	if detail.Root.Model != "openai/gpt-5-mini-2026-05-01" || detail.Root.Provider != "openai" {
		t.Fatalf("agent model/provider = %q/%q, want representative actual model", detail.Root.Model, detail.Root.Provider)
	}
	if detail.Root.Request.ModelSummary == nil || !detail.Root.Request.ModelSummary.Mixed || len(detail.Root.Request.ModelSummary.Models) != 2 {
		t.Fatalf("agent model summary = %#v, want mixed per-turn models", detail.Root.Request.ModelSummary)
	}
	if detail.Root.Request.Turns[0].Model != "anthropic/claude-sonnet-4" || detail.Root.Request.Turns[1].Model != "openai/gpt-5-mini-2026-05-01" {
		t.Fatalf("turn models = %#v, want concrete generation models", detail.Root.Request.Turns)
	}
	rowModels := map[string]RunDetailRow{}
	for _, row := range detail.Rows {
		if row.SpanID != "" {
			rowModels[row.SpanID] = row
		}
	}
	if rowModels["span_first"].Model != "anthropic/claude-sonnet-4" || rowModels["span_first"].Provider != "openrouter" {
		t.Fatalf("first turn row model/provider = %q/%q, want concrete generation model", rowModels["span_first"].Model, rowModels["span_first"].Provider)
	}
	if rowModels["span_final"].Model != "openai/gpt-5-mini-2026-05-01" || rowModels["span_final"].Provider != "openai" {
		t.Fatalf("final turn row model/provider = %q/%q, want output actual model", rowModels["span_final"].Model, rowModels["span_final"].Provider)
	}
}

func TestProjectRunDetailBuildsAggregateRunModelSummary(t *testing.T) {
	started := time.Date(2026, 6, 3, 11, 30, 0, 0, time.UTC)
	first := requestGenerationSpan("run_request_mixed", "trace_request_mixed", "span_first", "", "first turn", started.Add(time.Second), "first.prompt")
	first.Attributes = json.RawMessage(`{"actualModelId":"anthropic/claude-sonnet-4","provider":"openrouter"}`)
	final := requestGenerationSpan("run_request_mixed", "trace_request_mixed", "span_final", "", "final turn", started.Add(2*time.Second), "final.prompt")
	final.Attributes = json.RawMessage(`{"selectedModel":"openai/gpt-5-mini"}`)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_request_mixed",
			TraceID:       "trace_request_mixed",
			Name:          "mixed run",
			RootPrimitive: "custom.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(3 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    3000,
		},
		Spans: []SpanSummary{first, final},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact("run_request_mixed", "trace_request_mixed", "artifact_first_messages", "span_first", started.Add(time.Second), "First base.", "context:first", "artifact_first_context"),
			requestContextArtifact("run_request_mixed", "trace_request_mixed", "artifact_first_context", "span_first", started.Add(time.Second), "context:first", "First context."),
			requestMessagesArtifact("run_request_mixed", "trace_request_mixed", "artifact_final_messages", "span_final", started.Add(2*time.Second), "Final base.", "context:final", "artifact_final_context"),
			requestContextArtifact("run_request_mixed", "trace_request_mixed", "artifact_final_context", "span_final", started.Add(2*time.Second), "context:final", "Final context."),
			outputArtifact("run_request_mixed", "trace_request_mixed", "artifact_final_output", "span_final", started.Add(2500*time.Millisecond), "openai/gpt-5-mini-2026-05-01", "resp_final"),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_request_mixed", "trace_request_mixed", "edge_first_messages", "span_first", "artifact_first_messages", started.Add(time.Second)),
			requestConsumedEdge("run_request_mixed", "trace_request_mixed", "edge_final_messages", "span_final", "artifact_final_messages", started.Add(2*time.Second)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(4 * time.Second)})
	if !detail.Root.Virtual || detail.Root.Request == nil || detail.Root.Request.Mode != "aggregate" {
		t.Fatalf("root request = %#v virtual=%v, want virtual aggregate request", detail.Root.Request, detail.Root.Virtual)
	}
	if detail.Root.Model != "openai/gpt-5-mini-2026-05-01" || detail.Root.Provider != "openai" {
		t.Fatalf("run root model/provider = %q/%q, want representative actual model", detail.Root.Model, detail.Root.Provider)
	}
	if detail.Root.Request.ModelSummary == nil || !detail.Root.Request.ModelSummary.Mixed || len(detail.Root.Request.ModelSummary.Models) != 2 {
		t.Fatalf("run model summary = %#v, want mixed model summary", detail.Root.Request.ModelSummary)
	}
}

func TestRunDetailDisplayDoesNotUseModelAsNonGenerationLabel(t *testing.T) {
	span := SpanSummary{
		SpanID:     "span_step",
		Family:     "flow",
		Primitive:  "flow.step",
		Name:       "google/gemini-2.5-pro",
		StepID:     "plan-round-1",
		Model:      "google/gemini-2.5-pro",
		Attributes: json.RawMessage(`{"presentation":{"label":"google/gemini-2.5-pro"}}`),
	}

	display := runDetailDisplay(span)
	if display.Label != "plan-round-1" {
		t.Fatalf("display label = %q, want step id", display.Label)
	}
}

func TestProjectRunDetailFoldsRequestInputInternalsAndPreservesStepRequests(t *testing.T) {
	started := time.Date(2026, 6, 3, 12, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_nested_request_context",
			TraceID:       "trace_nested_request_context",
			Name:          "agent stream",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(4 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    4000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_nested_request_context",
				TraceID:    "trace_nested_request_context",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "agent stream",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(4 * time.Second).Format(time.RFC3339Nano),
				DurationMs: 4000,
			},
			{
				RunID:        "run_nested_request_context",
				TraceID:      "trace_nested_request_context",
				SpanID:       "span_stream",
				ParentSpanID: "span_agent",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "generateStream",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(3 * time.Second).Format(time.RFC3339Nano),
				DurationMs:   2900,
			},
			requestGenerationSpan("run_nested_request_context", "trace_nested_request_context", "span_step_1", "span_stream", "step 1", started.Add(time.Second), "agent.step"),
			{
				RunID:        "run_nested_request_context",
				TraceID:      "trace_nested_request_context",
				SpanID:       "span_retrieval",
				ParentSpanID: "span_step_1",
				Family:       "retrieval",
				Primitive:    "retrieval.pipeline",
				Name:         "project-content-search.pipeline",
				Status:       "ok",
				StartedAt:    started.Add(1100 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1200 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   100,
			},
			{
				RunID:        "run_nested_request_context",
				TraceID:      "trace_nested_request_context",
				SpanID:       "span_retrieve",
				ParentSpanID: "span_retrieval",
				Family:       "retrieval",
				Primitive:    "retrieval.query",
				Name:         "project-content-search.retrieve",
				Status:       "ok",
				StartedAt:    started.Add(1110 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1190 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   80,
			},
			{
				RunID:        "run_nested_request_context",
				TraceID:      "trace_nested_request_context",
				SpanID:       "span_embed",
				ParentSpanID: "span_retrieve",
				Family:       "embedding",
				Primitive:    "embedding.call",
				Name:         "dense.embed",
				Status:       "ok",
				StartedAt:    started.Add(1120 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1130 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   10,
			},
			{
				RunID:        "run_nested_request_context",
				TraceID:      "trace_nested_request_context",
				SpanID:       "span_memory",
				ParentSpanID: "span_retrieve",
				Family:       "memory",
				Primitive:    "memory.read",
				Name:         "facts.find",
				Status:       "ok",
				StartedAt:    started.Add(1130 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1140 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   10,
			},
			requestGenerationSpan("run_nested_request_context", "trace_nested_request_context", "span_step_2", "span_stream", "step 2", started.Add(2*time.Second), "agent.final"),
		},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact("run_nested_request_context", "trace_nested_request_context", "artifact_step_1_messages", "span_step_1", started.Add(time.Second), "Step 1 base.", "context:retrieval", "artifact_step_1_context"),
			requestContextArtifact("run_nested_request_context", "trace_nested_request_context", "artifact_step_1_context", "span_prompt_step_1", started.Add(time.Second), "context:retrieval", "Retrieved context."),
			requestMessagesArtifact("run_nested_request_context", "trace_nested_request_context", "artifact_step_2_messages", "span_step_2", started.Add(2*time.Second), "Step 2 base.", "context:final", "artifact_step_2_context"),
			requestContextArtifact("run_nested_request_context", "trace_nested_request_context", "artifact_step_2_context", "span_prompt_step_2", started.Add(2*time.Second), "context:final", "Final context."),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_nested_request_context", "trace_nested_request_context", "edge_step_1_messages", "span_step_1", "artifact_step_1_messages", started.Add(time.Second)),
			requestConsumedEdge("run_nested_request_context", "trace_nested_request_context", "edge_step_2_messages", "span_step_2", "artifact_step_2_messages", started.Add(2*time.Second)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(5 * time.Second)})
	step1 := findRunDetailNode(&detail.Root, "span_step_1")
	if step1 == nil {
		t.Fatalf("root = %#v, want visible step 1 generation", detail.Root)
	}
	if step1.Request == nil || step1.Request.Mode != "exact" {
		t.Fatalf("step 1 request = %#v, want exact request", step1.Request)
	}
	if len(step1.Request.Contributions) != 1 || step1.Request.Contributions[0].SourceID != "context:retrieval" {
		t.Fatalf("step 1 contributions = %#v, want referenced context contribution", step1.Request.Contributions)
	}
	if len(step1.Children) != 0 {
		t.Fatalf("step 1 children = %#v, want retrieval internals folded into details", step1.Children)
	}
	for _, spanID := range []string{"span_retrieval", "span_retrieve", "span_embed", "span_memory"} {
		placement := detail.SpanIndex[spanID]
		if placement.Placement != "detail" || placement.OwnerNodeID != step1.ID {
			t.Fatalf("%s placement = %#v, want detail owned by step 1", spanID, placement)
		}
	}
	stream := findRunDetailNode(&detail.Root, "span_stream")
	if stream == nil || stream.Request == nil || len(stream.Request.Turns) != 2 {
		t.Fatalf("stream request = %#v, want aggregate request with both generation steps", stream)
	}
	if detail.Root.Request == nil || len(detail.Root.Request.Turns) != 2 || detail.Root.Request.Representative.SpanID != "span_step_2" {
		t.Fatalf("agent request = %#v, want aggregate request from final step with both turns", detail.Root.Request)
	}
}

func TestProjectRunDetailKeepsOperationalRetrievalAndMemoryVisible(t *testing.T) {
	started := time.Date(2026, 6, 3, 12, 30, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_agent_resources",
			TraceID:       "trace_agent_resources",
			Name:          "agent resources",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_agent_resources",
				TraceID:    "trace_agent_resources",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "agent resources",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs: 1000,
			},
			{
				RunID:        "run_agent_resources",
				TraceID:      "trace_agent_resources",
				SpanID:       "span_retrieval",
				ParentSpanID: "span_agent",
				Family:       "retrieval",
				Primitive:    "retrieval.query",
				Name:         "workspace.search",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(200 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   100,
			},
			{
				RunID:        "run_agent_resources",
				TraceID:      "trace_agent_resources",
				SpanID:       "span_memory",
				ParentSpanID: "span_agent",
				Family:       "memory",
				Primitive:    "memory.read",
				Name:         "episodes.recall",
				Status:       "ok",
				StartedAt:    started.Add(250 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(300 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   50,
			},
			requestGenerationSpan("run_agent_resources", "trace_agent_resources", "span_generation", "span_agent", "generate", started.Add(500*time.Millisecond), "agent.answer"),
		},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact("run_agent_resources", "trace_agent_resources", "artifact_generation_messages", "span_generation", started.Add(500*time.Millisecond), "Answer base.", "context:agent", "artifact_context"),
			requestContextArtifact("run_agent_resources", "trace_agent_resources", "artifact_context", "span_generation", started.Add(500*time.Millisecond), "context:agent", "Agent context."),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_agent_resources", "trace_agent_resources", "edge_generation_messages", "span_generation", "artifact_generation_messages", started.Add(500*time.Millisecond)),
			requestConsumedContextEdge("run_agent_resources", "trace_agent_resources", "edge_generation_context", "artifact_context", "span_generation", started.Add(500*time.Millisecond)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	if findRunDetailNode(&detail.Root, "span_retrieval") == nil {
		t.Fatalf("root = %#v, want direct retrieval visible under agent", detail.Root)
	}
	if findRunDetailNode(&detail.Root, "span_memory") == nil {
		t.Fatalf("root = %#v, want direct memory visible under agent", detail.Root)
	}
	if placement := detail.SpanIndex["span_retrieval"]; placement.Placement != "node" {
		t.Fatalf("retrieval placement = %#v, want visible node", placement)
	}
	if placement := detail.SpanIndex["span_memory"]; placement.Placement != "node" {
		t.Fatalf("memory placement = %#v, want visible node", placement)
	}
}

func TestProjectRunDetailKeepsFlowRetrievalVisibleUnderAgentStream(t *testing.T) {
	started := time.Date(2026, 6, 3, 12, 45, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_flow_retrieval",
			TraceID:       "trace_flow_retrieval",
			Name:          "agent flow retrieval",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(2 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    2000,
		},
		Spans: []SpanSummary{
			{
				RunID:     "run_flow_retrieval",
				TraceID:   "trace_flow_retrieval",
				SpanID:    "span_agent",
				Family:    "agent",
				Primitive: "agent.run",
				Name:      "agent",
				Status:    "ok",
				StartedAt: started.Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_stream",
				ParentSpanID: "span_agent",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "stream response",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_tool",
				ParentSpanID: "span_stream",
				Family:       "tool",
				Primitive:    "tool.call",
				Name:         "research",
				Status:       "ok",
				StartedAt:    started.Add(200 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_flow",
				ParentSpanID: "span_tool",
				Family:       "flow",
				Primitive:    "flow.run",
				Name:         "research flow",
				Status:       "ok",
				StartedAt:    started.Add(300 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_step",
				ParentSpanID: "span_flow",
				Family:       "flow",
				Primitive:    "flow.step",
				Name:         "searchContent",
				Status:       "ok",
				StartedAt:    started.Add(400 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_pipeline",
				ParentSpanID: "span_step",
				Family:       "retrieval",
				Primitive:    "retrieval.pipeline",
				Name:         "project-content-search.pipeline",
				Status:       "ok",
				StartedAt:    started.Add(500 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_query",
				ParentSpanID: "span_pipeline",
				Family:       "retrieval",
				Primitive:    "retrieval.query",
				Name:         "project-content-search.retrieve",
				Status:       "ok",
				StartedAt:    started.Add(550 * time.Millisecond).Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_flow_retrieval",
				TraceID:      "trace_flow_retrieval",
				SpanID:       "span_embed",
				ParentSpanID: "span_query",
				Family:       "embedding",
				Primitive:    "embedding.call",
				Name:         "content.embed",
				Status:       "ok",
				StartedAt:    started.Add(600 * time.Millisecond).Format(time.RFC3339Nano),
			},
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(3 * time.Second)})
	step := findRunDetailNode(&detail.Root, "span_step")
	if step == nil {
		t.Fatalf("root = %#v, want visible flow step", detail.Root)
	}
	pipeline := findRunDetailNode(&detail.Root, "span_pipeline")
	if pipeline == nil {
		t.Fatalf("root = %#v, want retrieval pipeline visible under flow step", detail.Root)
	}
	if pipeline.ParentID != step.ID {
		t.Fatalf("pipeline parent = %q, want flow step %q", pipeline.ParentID, step.ID)
	}
	if placement := detail.SpanIndex["span_pipeline"]; placement.Placement != "node" {
		t.Fatalf("pipeline placement = %#v, want visible node", placement)
	}
	for _, spanID := range []string{"span_query", "span_embed"} {
		placement := detail.SpanIndex[spanID]
		if placement.Placement != "detail" || placement.OwnerNodeID != pipeline.ID {
			t.Fatalf("%s placement = %#v, want detail owned by pipeline", spanID, placement)
		}
		if len(placement.Path) == 0 || placement.Path[len(placement.Path)-1] != "detail:"+spanID {
			t.Fatalf("%s path = %#v, want path ending at its own detail id", spanID, placement.Path)
		}
	}
}

func TestProjectRunDetailInheritsNearestStreamRequestForAgentSteps(t *testing.T) {
	started := time.Date(2026, 6, 3, 13, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_inherited_agent_context",
			TraceID:       "trace_inherited_agent_context",
			Name:          "agent stream",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(3 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    3000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_inherited_agent_context",
				TraceID:    "trace_inherited_agent_context",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "agent stream",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(3 * time.Second).Format(time.RFC3339Nano),
				DurationMs: 3000,
				Attributes: json.RawMessage(`{"toolNames":["agentSearch","agentMemory"]}`),
			},
			{
				RunID:        "run_inherited_agent_context",
				TraceID:      "trace_inherited_agent_context",
				SpanID:       "span_context",
				ParentSpanID: "span_agent",
				Family:       "context",
				Primitive:    "context.resolve",
				Name:         "context thread",
				Status:       "ok",
				StartedAt:    started.Add(50 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(80 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   30,
			},
			{
				RunID:        "run_inherited_agent_context",
				TraceID:      "trace_inherited_agent_context",
				SpanID:       "span_stream",
				ParentSpanID: "span_agent",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "generateStream",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(2500 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   2400,
			},
			requestGenerationSpan("run_inherited_agent_context", "trace_inherited_agent_context", "span_step_1", "span_stream", "step 1", started.Add(time.Second), "agent.step"),
			{
				RunID:        "run_inherited_agent_context",
				TraceID:      "trace_inherited_agent_context",
				SpanID:       "span_tool",
				ParentSpanID: "span_step_1",
				Family:       "tool",
				Primitive:    "tool.call",
				Name:         "researchTool",
				Status:       "ok",
				StartedAt:    started.Add(1600 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(2900 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   1300,
			},
			{
				RunID:        "run_inherited_agent_context",
				TraceID:      "trace_inherited_agent_context",
				SpanID:       "span_tool_flow",
				ParentSpanID: "span_tool",
				Family:       "flow",
				Primitive:    "flow.run",
				Name:         "research flow",
				Status:       "ok",
				StartedAt:    started.Add(1700 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(2850 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   1150,
			},
			requestGenerationSpan("run_inherited_agent_context", "trace_inherited_agent_context", "span_research_planner", "span_tool_flow", "generate research-planner", started.Add(2800*time.Millisecond), "research-planner"),
			requestGenerationSpan("run_inherited_agent_context", "trace_inherited_agent_context", "span_step_2", "span_stream", "step 2", started.Add(2*time.Second), "agent.final"),
		},
		Artifacts: []ArtifactSummary{
			convexAgentMessagesArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_stream_call_args", "span_stream", started.Add(100*time.Millisecond), "call-args", "Agent call args."),
			convexAgentMessagesArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_stream_thread_context", "span_stream", started.Add(200*time.Millisecond), "thread-context", "Agent thread context."),
			requestContextArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_stream_context", "span_context", started.Add(100*time.Millisecond), "context:thread", "Thread context."),
			outputMessagesArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_step_1_output", "span_step_1", started.Add(1500*time.Millisecond)),
			outputMessagesArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_step_2_output", "span_step_2", started.Add(2500*time.Millisecond)),
			requestMessagesArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_research_messages", "span_research_planner", started.Add(2800*time.Millisecond), "Research base.", "context:research", "artifact_research_context"),
			requestContextArtifact("run_inherited_agent_context", "trace_inherited_agent_context", "artifact_research_context", "span_research_context", started.Add(2800*time.Millisecond), "context:research", "Research context."),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_inherited_agent_context", "trace_inherited_agent_context", "edge_stream_call_args", "span_stream", "artifact_stream_call_args", started.Add(100*time.Millisecond)),
			requestConsumedEdge("run_inherited_agent_context", "trace_inherited_agent_context", "edge_stream_thread_context", "span_stream", "artifact_stream_thread_context", started.Add(200*time.Millisecond)),
			requestConsumedEdge("run_inherited_agent_context", "trace_inherited_agent_context", "edge_research_messages", "span_research_planner", "artifact_research_messages", started.Add(2800*time.Millisecond)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(4 * time.Second)})
	step1 := findRunDetailNode(&detail.Root, "span_step_1")
	if step1 == nil {
		t.Fatalf("root = %#v, want visible step 1 generation", detail.Root)
	}
	if step1.Request == nil || step1.Request.Mode != "inherited" {
		t.Fatalf("step 1 request = %#v, want inherited stream request", step1.Request)
	}
	if step1.Request.Representative == nil || step1.Request.Representative.SpanID != "span_stream" {
		t.Fatalf("step 1 representative = %#v, want stream ancestor", step1.Request.Representative)
	}
	if step1.Request.Messages == nil || step1.Request.Messages.Phase != "thread-context" || len(step1.Request.Messages.AllMessages) == 0 {
		t.Fatalf("step 1 messages = %#v, want inherited thread-context request", step1.Request.Messages)
	}
	if step1.Request.BasePrompt == nil || step1.Request.BasePrompt.Text != "Agent thread context." {
		t.Fatalf("step 1 base prompt = %#v, want inherited thread-context system", step1.Request.BasePrompt)
	}
	if len(step1.Request.Contributions) != 1 || step1.Request.Contributions[0].SourceID != "context:thread" {
		t.Fatalf("step 1 contributions = %#v, want inherited thread context", step1.Request.Contributions)
	}
	if len(step1.Request.Tools) != 2 || step1.Request.Tools[0].Name != "agentSearch" || step1.Request.Tools[1].Name != "agentMemory" {
		t.Fatalf("step 1 tools = %#v, want inherited agent tool names", step1.Request.Tools)
	}
	step2 := findRunDetailNode(&detail.Root, "span_step_2")
	if step2 == nil || step2.Request == nil || step2.Request.Messages == nil || len(step2.Request.Messages.PreviousStepMessages) == 0 {
		t.Fatalf("step 2 request messages = %#v, want accumulated previous step messages", step2)
	}

	stream := findRunDetailNode(&detail.Root, "span_stream")
	if stream == nil || stream.Request == nil || stream.Request.Mode != "aggregate" || len(stream.Request.Turns) != 2 {
		t.Fatalf("stream request = %#v, want aggregate request over inherited generation steps", stream)
	}
	if stream.Request.Representative == nil || stream.Request.Representative.SpanID != "span_step_2" {
		t.Fatalf("stream representative = %#v, want final inherited step", stream.Request.Representative)
	}
	if detail.Root.Request == nil || detail.Root.Request.Mode != "aggregate" || detail.Root.Request.Representative.SpanID != "span_step_2" {
		t.Fatalf("agent request = %#v, want aggregate request from final inherited step", detail.Root.Request)
	}
}

func TestProjectRunDetailInheritsFoldedStreamDetailRequestForSingleAgentStep(t *testing.T) {
	started := time.Date(2026, 6, 3, 14, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_folded_stream_context",
			TraceID:       "trace_folded_stream_context",
			Name:          "agent stream",
			RootPrimitive: "agent.run",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(2 * time.Second).Format(time.RFC3339Nano),
			DurationMs:    2000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_folded_stream_context",
				TraceID:    "trace_folded_stream_context",
				SpanID:     "span_agent",
				Family:     "agent",
				Primitive:  "agent.run",
				Name:       "agent stream",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(2 * time.Second).Format(time.RFC3339Nano),
				DurationMs: 2000,
			},
			{
				RunID:        "run_folded_stream_context",
				TraceID:      "trace_folded_stream_context",
				SpanID:       "span_stream",
				ParentSpanID: "span_agent",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "generateStream",
				Status:       "ok",
				StartedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(1500 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   1400,
			},
			requestGenerationSpan("run_folded_stream_context", "trace_folded_stream_context", "span_step", "span_stream", "step 1", started.Add(time.Second), "agent.step"),
		},
		Artifacts: []ArtifactSummary{
			convexAgentMessagesArtifact("run_folded_stream_context", "trace_folded_stream_context", "artifact_stream_thread_context", "span_stream", started.Add(200*time.Millisecond), "thread-context", "Folded stream context."),
			outputMessagesArtifact("run_folded_stream_context", "trace_folded_stream_context", "artifact_step_output", "span_step", started.Add(1500*time.Millisecond)),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge("run_folded_stream_context", "trace_folded_stream_context", "edge_stream_thread_context", "span_stream", "artifact_stream_thread_context", started.Add(200*time.Millisecond)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(3 * time.Second)})
	step := findRunDetailNode(&detail.Root, "span_step")
	if step == nil {
		t.Fatalf("root = %#v, want visible folded stream child step", detail.Root)
	}
	if placement := detail.SpanIndex["span_stream"]; placement.Placement != "detail" || placement.OwnerNodeID != step.ID {
		t.Fatalf("stream placement = %#v, want folded detail owned by step", placement)
	}
	if step.Request == nil || step.Request.Mode != "inherited" {
		t.Fatalf("step request = %#v, want inherited folded stream request", step.Request)
	}
	if step.Request.Representative == nil || step.Request.Representative.SpanID != "span_stream" {
		t.Fatalf("step representative = %#v, want folded stream detail", step.Request.Representative)
	}
	if step.Request.BasePrompt == nil || step.Request.BasePrompt.Text != "Folded stream context." {
		t.Fatalf("step base prompt = %#v, want folded stream system", step.Request.BasePrompt)
	}
}

func requestGenerationSpan(runID, traceID, spanID, parentSpanID, name string, started time.Time, promptID string) SpanSummary {
	return SpanSummary{
		RunID:        runID,
		TraceID:      traceID,
		SpanID:       spanID,
		ParentSpanID: parentSpanID,
		Family:       "generation",
		Primitive:    "generation.call",
		Name:         name,
		Status:       "ok",
		StartedAt:    started.Format(time.RFC3339Nano),
		EndedAt:      started.Add(500 * time.Millisecond).Format(time.RFC3339Nano),
		DurationMs:   500,
		PromptID:     promptID,
	}
}

func requestMessagesArtifact(runID, traceID, artifactID, spanID string, created time.Time, basePrompt, contextSource, contextArtifactID string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"system": basePrompt + "\n\n" + contextSource,
		"systemBlocks": []map[string]string{
			{"source": "prompt", "text": basePrompt},
			{"source": contextSource, "text": contextSource, "artifactId": contextArtifactID},
		},
		"messages":  []map[string]string{{"role": "user", "content": "go"}},
		"toolNames": []string{"sharedTool"},
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "messages",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func outputMessagesArtifact(runID, traceID, artifactID, spanID string, created time.Time) ArtifactSummary {
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "messages",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     json.RawMessage(`[{"type":"text","text":"done"}]`),
	}
}

func outputArtifact(runID, traceID, artifactID, spanID string, created time.Time, modelID, responseID string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"text": "done",
		"meta": map[string]string{
			"actualModelId": modelID,
			"responseId":    responseID,
		},
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "output",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func convexAgentMessagesArtifact(runID, traceID, artifactID, spanID string, created time.Time, phase string, system string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"source":            "convex.agent",
		"phase":             phase,
		"system":            system,
		"prompt":            "go",
		"messages":          []map[string]string{{"role": "user", "content": "go"}},
		"allMessages":       []map[string]string{{"role": "user", "content": "thread go"}},
		"inputMessages":     []map[string]string{{"role": "user", "content": "go"}},
		"inputPrompt":       []map[string]string{{"role": "user", "content": "go"}},
		"recent":            []map[string]string{{"role": "assistant", "content": "previous"}},
		"existingResponses": []map[string]string{},
		"search":            []map[string]string{},
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "messages",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func requestContextArtifact(runID, traceID, artifactID, spanID string, created time.Time, sourceID, text string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"kind":           "context.contribution",
		"state":          "active",
		"included":       true,
		"sourceId":       sourceID,
		"injectableKind": "context",
		"injects":        []string{"system"},
		"priority":       50,
		"tokens":         2,
		"text":           text,
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "context.contribution",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func requestConsumedEdge(runID, traceID, edgeID, spanID, artifactID string, created time.Time) EdgeSummary {
	return EdgeSummary{
		EdgeID:    edgeID,
		RunID:     runID,
		TraceID:   traceID,
		EdgeType:  "consumed",
		From:      NodeRef{Kind: "span", ID: spanID},
		To:        NodeRef{Kind: "artifact", ID: artifactID},
		CreatedAt: created.Format(time.RFC3339Nano),
	}
}

func requestConsumedContextEdge(runID, traceID, edgeID, artifactID, spanID string, created time.Time) EdgeSummary {
	return EdgeSummary{
		EdgeID:    edgeID,
		RunID:     runID,
		TraceID:   traceID,
		EdgeType:  "consumed",
		From:      NodeRef{Kind: "artifact", ID: artifactID},
		To:        NodeRef{Kind: "span", ID: spanID},
		CreatedAt: created.Format(time.RFC3339Nano),
	}
}
