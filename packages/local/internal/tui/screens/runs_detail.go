package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// --- right pane: span detail ------------------------------------------------

func (s *Runs) renderSpanDetail(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	if s.detail == nil || len(s.detail.Spans) == 0 {
		header := shell.PaneHeader(width, "span: —", "", "")
		body := centerMsg(Size{Width: width, Height: max(0, height-3)}, "no span selected")
		return kit.PadBlock(header+"\n"+body, width, height)
	}
	span := s.currentSpan()
	if span == nil {
		span = &s.detail.Spans[0]
	}
	bodyHeight := max(0, height-3)
	position := s.spanDocument.Position()
	right := ""
	if position.TotalLines > bodyHeight && bodyHeight > 0 {
		right = shell.TextMuted.Render(formatDocumentPosition(position))
	}
	duration := formatSpanDuration(deref(span.DurationMs))
	title := spanDocumentTitle(span.Name, width, duration, right, s.focus == focusSpanDetail)
	header := shell.PaneHeader(width, title, duration, right)
	lines := strings.Split(kit.PadBlock(header, width, min(3, height)), "\n")
	lines = append(lines, s.spanDocument.Render()...)
	return strings.Join(lines, "\n")
}

func (s *Runs) renderSpanDetailDocument(span *api.InspectRunSpan, width int) string {
	var b strings.Builder

	// IDENTITY — exactly 4 rows per the design: span_id · parent · kind · op.
	// `primitive` is intentionally omitted — for agent/tool/llm spans it
	// duplicates `kind`/`op`, and surfacing it as a separate row crowded
	// the panel.
	b.WriteString(s.section("IDENTITY"))
	b.WriteString(kvRow("span_id", truncate(span.ID, 18), width))
	b.WriteString(kvRow("parent", parentLabel(span), width))
	b.WriteString(kvRow("kind", span.Kind, width))
	b.WriteString(kvRowColored("op", span.Op, spanOpColor(span.Op), width))
	b.WriteString("\n")

	// TIMING
	b.WriteString(s.section("TIMING"))
	b.WriteString(kvRow("start", formatSpanStart(span.StartedAt, s.detail.Trace.StartedAt), width))
	dur := formatSpanDuration(deref(span.DurationMs))
	b.WriteString(kvRowColored("duration", dur, durationColor(span.DurationMs, s.detail.Run.DurationMs), width))
	b.WriteString(kvRow("self", "—", width)) // self time not exposed by backend
	b.WriteString(s.childrenRow(span, width))
	b.WriteString("\n")

	// COST
	if span.TokenCount > 0 || span.Cost != nil {
		b.WriteString(s.section("COST"))
		if span.TokenCount > 0 {
			b.WriteString(kvRowColored("tokens", commaInt(span.TokenCount), tokenColor(span.TokenCount), width))
		}
		if span.Cost != nil {
			b.WriteString(kvRow("$", fmt.Sprintf("$%.3f", *span.Cost), width))
		}
		b.WriteString("\n")
	}

	// ERROR — normalized failure evidence from observability. Kept above
	// primitive details so execution failures are visible even when the
	// primitive payload is large or generic.
	if errPayload := renderSpanError(*span, width); errPayload != "" {
		b.WriteString(s.section("ERROR"))
		b.WriteString(errPayload)
		b.WriteString("\n")
	}

	// Primitive-specific details — curated kvRows per primitive (no
	// JSON dumps). Tool spans surface name/args-preview/result-
	// preview/error; generations surface model/tokens/finish reason;
	// retrieval surfaces query/hits/score; etc. Header reads as the
	// primitive's name (`TOOL`, `GENERATION`, `RETRIEVAL`, …) so the
	// user immediately sees what kind of span they're inspecting.
	if payload := renderPrimitivePayload(*span, width); payload != "" {
		b.WriteString(s.section(spanDetailHeader(span)))
		b.WriteString(payload)
		b.WriteString("\n")
	}

	// TIMINGS — only when the primitive carries detailed timing signals.
	if span.Timings != nil {
		b.WriteString(s.section("TIMINGS"))
		if span.Timings.TTFTMs != nil {
			b.WriteString(kvRow("ttft", fmt.Sprintf("%.0fms", *span.Timings.TTFTMs), width))
		}
		if span.Timings.TotalChunks != nil {
			b.WriteString(kvRow("chunks", fmt.Sprintf("%d", *span.Timings.TotalChunks), width))
		}
		if span.Timings.TokensPerSecond != nil {
			b.WriteString(kvRow("tok/s", fmt.Sprintf("%.0f", *span.Timings.TokensPerSecond), width))
		}
		if span.Timings.Retries > 0 {
			b.WriteString(kvRowColored("retries", fmt.Sprintf("%d", span.Timings.Retries), shell.ColorAmber, width))
		}
		b.WriteString("\n")
	}

	// ATTRIBUTES — always shown when populated. The design renders
	// these as the primary "what was this span configured with"
	// surface (agent.name, agent.iter.max, query.lang, retriever.k,
	// etc.) — they're more informative than a JSON payload dump.
	if len(span.Attributes) > 0 {
		b.WriteString(s.section("ATTRIBUTES"))
		b.WriteString(renderAttributes(span.Attributes, width))
		b.WriteString("\n")
	}

	// LINKED INSIGHTS — colored bullet + ID + compact relationship note.
	if len(span.LinkedInsightIDs) > 0 {
		b.WriteString(s.section("LINKED INSIGHTS"))
		for _, id := range span.LinkedInsightIDs {
			bullet := lipgloss.NewStyle().Foreground(shell.ColorRose).Render("●")
			b.WriteString(" " + bullet + "  ")
			b.WriteString(shell.Text.Render(padString2(id, 10)))
			b.WriteString("  ")
			b.WriteString(shell.TextMuted.Render("linked"))
			b.WriteString("\n")
		}
	}

	return strings.TrimRight(b.String(), "\n")
}

func formatDocumentPosition(position kit.DocumentPosition) string {
	return fmt.Sprintf("%d-%d/%d", position.FirstLine, position.LastLine, position.TotalLines)
}

func spanDocumentTitle(name string, width int, subtitle, right string, focused bool) string {
	available := width - lipgloss.Width(subtitle) - lipgloss.Width(right) - 7
	if subtitle == "" {
		available += 4
	}
	if focused {
		available -= 2
	}
	nameWidth := max(0, available-lipgloss.Width("span: "))
	return focusTitle("span: "+kit.Truncate(name, nameWidth, "…"), focused)
}

func (s *Runs) section(label string) string {
	return " " + shell.SectionTag.Render(label) + "\n"
}

// spanDetailHeader picks the section title for the primitive-details
// block. Maps both legacy (`tool`) and detailed (`tool.call`) primitive
// strings to the same family name. Generic primitives fall back to
// `PAYLOAD` so the section still has a stable label.
func spanDetailHeader(span *api.InspectRunSpan) string {
	switch span.Primitive {
	case api.SpanPrimitiveTool, api.SpanPrimitiveToolCall, api.SpanPrimitiveToolApproval:
		return "TOOL"
	case api.SpanPrimitiveTrace, api.SpanPrimitiveGeneration,
		api.SpanPrimitiveGenerationCall, api.SpanPrimitiveGenerationStream:
		return "GENERATION"
	case api.SpanPrimitiveFlow, api.SpanPrimitiveFlowRun, api.SpanPrimitiveFlowStep:
		return "FLOW"
	case api.SpanPrimitiveEvalRun, api.SpanPrimitiveEvalCase:
		return "EVAL"
	case api.SpanPrimitivePipeline, api.SpanPrimitiveCompositionPipeline:
		return "PIPELINE"
	case api.SpanPrimitiveParallel, api.SpanPrimitiveCompositionParallel:
		return "PARALLEL"
	case api.SpanPrimitiveConsensus, api.SpanPrimitiveCompositionConsensus:
		return "CONSENSUS"
	case api.SpanPrimitiveSwarm, api.SpanPrimitiveCompositionSwarm:
		return "SWARM"
	case api.SpanPrimitiveCompositionBranch:
		return "BRANCH"
	case api.SpanPrimitiveCompositionJoin:
		return "JOIN"
	case api.SpanPrimitiveCompositionVote:
		return "VOTE"
	case api.SpanPrimitiveDelegate, api.SpanPrimitiveDelegateInvoke:
		return "DELEGATE"
	case api.SpanPrimitiveHandoff, api.SpanPrimitiveHandoffPrepare:
		return "HANDOFF"
	case api.SpanPrimitiveRetrieval, api.SpanPrimitiveRetrievalStage,
		api.SpanPrimitiveRetrievalQuery:
		return "RETRIEVAL"
	case api.SpanPrimitiveEmbed, api.SpanPrimitiveEmbeddingCall:
		return "EMBEDDING"
	case api.SpanPrimitiveJudge, api.SpanPrimitiveScoringJudge:
		return "JUDGE"
	case api.SpanPrimitiveCitationCheck:
		return "CITATION CHECK"
	case api.SpanPrimitiveMemory, api.SpanPrimitiveMemoryRead, api.SpanPrimitiveMemoryWrite:
		return "MEMORY"
	case api.SpanPrimitiveBlackboard:
		return "BLACKBOARD"
	case api.SpanPrimitiveCompact, api.SpanPrimitiveCompactionRun:
		return "COMPACTION"
	case api.SpanPrimitiveAgent, api.SpanPrimitiveAgentRun:
		return "AGENT"
	case api.SpanPrimitivePromptResolve:
		return "PROMPT"
	case api.SpanPrimitiveContextResolve, api.SpanPrimitiveContextPredicate,
		api.SpanPrimitiveContextCache:
		return "CONTEXT"
	case api.SpanPrimitivePlan, api.SpanPrimitivePlanOperation:
		return "PLAN"
	case api.SpanPrimitiveTask, api.SpanPrimitiveTaskOperation:
		return "TASK"
	case api.SpanPrimitiveCache, api.SpanPrimitiveCacheLookup:
		return "CACHE"
	}
	return "PAYLOAD"
}

func (s *Runs) childrenRow(span *api.InspectRunSpan, width int) string {
	children, dup := s.childrenStats(span.ID)
	if children == 0 {
		return kvRow("children", "—", width)
	}
	label := fmt.Sprintf("%d", children)
	if dup > 0 {
		label += fmt.Sprintf(" (%d dup)", dup)
		return kvRowColored("children", label, shell.ColorRose, width)
	}
	return kvRow("children", label, width)
}

func (s *Runs) childrenStats(parentID string) (count, dups int) {
	if s.detail == nil {
		return 0, 0
	}
	for _, sp := range s.detail.Spans {
		if sp.ParentID == parentID {
			count++
			if sp.Duplicate {
				dups++
			}
		}
	}
	return
}
