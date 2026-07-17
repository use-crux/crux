package screens

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// formatTokensShort returns a one-decimal compact token count
// ("18.1k", "5.8k", "—" for zero). Matches the V1 Panels design which
// is more readable than the integer-k form `18k`.
func formatTokensShort(n int) string {
	if n <= 0 {
		return "—"
	}
	if n < 1000 {
		return fmt.Sprintf("%d", n)
	}
	// Show one decimal until we hit 1M.
	if n < 1_000_000 {
		// `18100 → 18.1k`. Avoid trailing zero ("18.0k" → "18k").
		v := float64(n) / 1000.0
		if v == float64(int(v)) {
			return fmt.Sprintf("%dk", int(v))
		}
		return fmt.Sprintf("%.1fk", v)
	}
	return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
}

// renderPrimitivePayload renders the span's `Data` field in a way that's
// idiomatic for the primitive it represents. Falls back to a pretty-printed
// JSON block when the primitive is `other` or the payload doesn't match the
// expected shape.
func renderPrimitivePayload(span api.InspectRunSpan, width int) string {
	if len(span.Data) == 0 {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(span.Data, &payload); err != nil {
		return ""
	}
	// _start is preserved for replay; strip from the visible projection.
	delete(payload, "_start")

	// Backend can emit either the legacy short primitive (`tool`,
	// `generation`, `flow`) or the canonical detailed form
	// (`tool.call`, `generation.call`, `flow.run`). Both have to dispatch
	// to the same renderer — pre-fix only the short forms matched, so
	// real spans (which use detailed forms) fell through to the generic
	// renderer and the per-primitive blocks never appeared.
	switch span.Primitive {
	// --- tool ---
	case api.SpanPrimitiveTool, api.SpanPrimitiveToolCall, api.SpanPrimitiveToolApproval:
		return renderToolPayload(payload, width)

	// --- generation / LLM ---
	case api.SpanPrimitiveTrace, api.SpanPrimitiveGeneration,
		api.SpanPrimitiveGenerationCall, api.SpanPrimitiveGenerationStream:
		return renderGenerationPayload(payload, width)

	// --- flow ---
	case api.SpanPrimitiveFlow, api.SpanPrimitiveFlowRun, api.SpanPrimitiveFlowStep,
		api.SpanPrimitiveEvalFlow, api.SpanPrimitiveEvalRun, api.SpanPrimitiveEvalCase:
		return renderFlowPayload(payload, width)

	// --- composition ---
	case api.SpanPrimitivePipeline, api.SpanPrimitiveParallel,
		api.SpanPrimitiveConsensus, api.SpanPrimitiveSwarm,
		api.SpanPrimitiveCompositionPipeline, api.SpanPrimitiveCompositionParallel,
		api.SpanPrimitiveCompositionConsensus, api.SpanPrimitiveCompositionSwarm,
		api.SpanPrimitiveCompositionBranch, api.SpanPrimitiveCompositionJoin,
		api.SpanPrimitiveCompositionVote:
		return renderCompositionPayload(payload, span.CompositionType, width)

	// --- delegate / handoff ---
	case api.SpanPrimitiveDelegate, api.SpanPrimitiveDelegateInvoke:
		return renderDelegatePayload(payload, width)
	case api.SpanPrimitiveHandoff, api.SpanPrimitiveHandoffPrepare:
		return renderHandoffPayload(payload, width)

	// --- retrieval / embedding ---
	case api.SpanPrimitiveRetrieval, api.SpanPrimitiveRetrievalStage,
		api.SpanPrimitiveRetrievalQuery:
		return renderRetrievalPayload(payload, width)
	case api.SpanPrimitiveEmbed, api.SpanPrimitiveEmbeddingCall:
		return renderEmbedPayload(payload, width)

	// --- judging / scoring ---
	case api.SpanPrimitiveJudge, api.SpanPrimitiveScoringJudge,
		api.SpanPrimitiveCitationCheck:
		return renderJudgePayload(payload, width)

	// --- memory / blackboard ---
	case api.SpanPrimitiveMemory, api.SpanPrimitiveMemoryRead,
		api.SpanPrimitiveMemoryWrite:
		return renderMemoryPayload(payload, width)
	case api.SpanPrimitiveBlackboard:
		return renderBlackboardPayload(payload, width)

	// --- compaction ---
	case api.SpanPrimitiveCompact, api.SpanPrimitiveCompactionRun:
		return renderCompactPayload(payload, width)

	// --- agent / prompt / context (use generic kvRows for now —
	// these primitives don't have a dedicated renderer yet; the
	// generic one surfaces all their fields cleanly).
	default:
		return renderGenericPayload(payload, width)
	}
}

func renderSpanError(span api.InspectRunSpan, width int) string {
	var b strings.Builder
	if hasJSONValue(span.Error) {
		b.WriteString(renderObservedError(span.Error, width))
	}
	for _, item := range span.Inspection["errors"] {
		if item.Type == "span.error" && sameJSON(item.Data, span.Error) {
			continue
		}
		label := firstNonEmpty(item.Label, item.Kind, item.Type, item.ID)
		if label == "" {
			label = "error"
		}
		preview := errorPreview(item.Data, previewMax(width))
		if preview == "" {
			preview = item.ID
		}
		if preview == "" {
			continue
		}
		b.WriteString(kvRowColored(label, truncate(preview, previewMax(width)), shell.ColorRose, width))
	}
	return b.String()
}

func renderObservedError(raw json.RawMessage, width int) string {
	payload := decodeRawObject(raw)
	if len(payload) == 0 {
		text := strings.TrimSpace(string(raw))
		if text == "" || text == "null" || text == "{}" {
			return ""
		}
		return kvRowColored("error", truncate(text, previewMax(width)), shell.ColorRose, width)
	}

	var b strings.Builder
	if name := firstNonEmpty(stringField(payload, "name"), stringField(payload, "type"), stringField(payload, "thrown")); name != "" {
		b.WriteString(kvRowColored("name", name, shell.ColorRose, width))
	}
	if msg := firstNonEmpty(stringField(payload, "message"), stringField(payload, "summary"), stringField(payload, "error")); msg != "" {
		b.WriteString(kvRowColored("message", truncate(msg, previewMax(width)), shell.ColorRose, width))
	}
	if category := stringField(payload, "category"); category != "" {
		b.WriteString(kvRow("category", category, width))
	}
	if code := firstNonEmpty(stringField(payload, "code"), stringField(payload, "statusCode")); code != "" {
		b.WriteString(kvRow("code", code, width))
	}
	if retryable, ok := payload["retryable"]; ok {
		b.WriteString(kvRow("retryable", valuePreview(retryable, previewMax(width)), width))
	}
	if stack := stringField(payload, "stack"); stack != "" {
		b.WriteString(kvRowColored("stack", stackPreview(stack, previewMax(width)), shell.ColorRose, width))
	}
	return b.String()
}

func errorPreview(raw json.RawMessage, max int) string {
	payload := decodeRawObject(raw)
	if len(payload) == 0 {
		return valuePreview(strings.TrimSpace(string(raw)), max)
	}
	if msg := firstNonEmpty(stringField(payload, "message"), stringField(payload, "summary"), stringField(payload, "error")); msg != "" {
		return msg
	}
	if stack := stringField(payload, "stack"); stack != "" {
		return stackPreview(stack, max)
	}
	if rawValue, ok := payload["raw"]; ok {
		return valuePreview(rawValue, max)
	}
	return valuePreview(payload, max)
}

func stackPreview(stack string, max int) string {
	lines := strings.Split(stack, "\n")
	parts := make([]string, 0, 2)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		parts = append(parts, trimmed)
		if len(parts) == 2 {
			break
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return truncate(strings.Join(parts, " | "), max)
}

func hasJSONValue(raw json.RawMessage) bool {
	text := strings.TrimSpace(string(raw))
	return text != "" && text != "null" && text != "{}"
}

func sameJSON(a, b json.RawMessage) bool {
	return strings.TrimSpace(string(a)) == strings.TrimSpace(string(b))
}

// --- per-primitive renderers ---------------------------------------------

func renderToolPayload(p map[string]any, width int) string {
	var b strings.Builder
	if name := stringField(p, "toolName"); name != "" {
		b.WriteString(kvRowColored("tool", name, shell.ColorAmber, width))
	}
	// Args and result rendered as one-line previews — the full
	// structured payload is available via the `i` inspect-raw overlay.
	if args, ok := p["args"]; ok && args != nil {
		b.WriteString(kvRow("args", valuePreview(args, previewMax(width)), width))
	}
	if result, ok := p["result"]; ok && result != nil {
		b.WriteString(kvRow("result", valuePreview(result, previewMax(width)), width))
	}
	if e := stringField(p, "error"); e != "" {
		b.WriteString(kvRowColored("error", truncate(e, previewMax(width)), shell.ColorRose, width))
	}
	if size := intField(p, "outputSize"); size > 0 {
		b.WriteString(kvRow("output size", fmt.Sprintf("%d bytes", size), width))
	}
	if save := intField(p, "tokenSavingsEstimate"); save > 0 {
		b.WriteString(kvRowColored("token savings", fmt.Sprintf("%d", save), shell.ColorGreen, width))
	}
	return b.String()
}

// previewMax computes how many characters a value-preview can use
// based on the pane width — leaves room for the key column + padding.
func previewMax(width int) int {
	n := width - 24
	if n < 16 {
		n = 16
	}
	return n
}

func renderGenerationPayload(p map[string]any, width int) string {
	var b strings.Builder
	provider := stringField(p, "provider")
	model := stringField(p, "model")
	switch {
	case provider != "" && model != "":
		b.WriteString(kvRow("model", provider+"/"+model, width))
	case model != "":
		b.WriteString(kvRow("model", model, width))
	case provider != "":
		b.WriteString(kvRow("provider", provider, width))
	}
	if target := stringField(p, "targetId"); target != "" {
		b.WriteString(kvRow("target", target, width))
	}
	if temp := floatField(p, "temperature"); temp > 0 {
		b.WriteString(kvRow("temperature", fmt.Sprintf("%.2f", temp), width))
	}
	if max := intField(p, "maxTokens"); max > 0 {
		b.WriteString(kvRow("max tokens", fmt.Sprintf("%d", max), width))
	}
	// Usage rolls up the per-side token counts. Pull them out as
	// individual rows when present so the user sees prompt vs output
	// vs total without unfolding a payload.
	if usage, ok := p["usage"].(map[string]any); ok {
		if pt := intField(usage, "promptTokens"); pt > 0 {
			b.WriteString(kvRow("prompt tok", fmt.Sprintf("%d", pt), width))
		}
		if ct := intField(usage, "completionTokens"); ct > 0 {
			b.WriteString(kvRow("output tok", fmt.Sprintf("%d", ct), width))
		}
		if tt := intField(usage, "totalTokens"); tt > 0 && (intField(usage, "promptTokens") == 0 && intField(usage, "completionTokens") == 0) {
			b.WriteString(kvRow("total tok", fmt.Sprintf("%d", tt), width))
		}
	}
	if finish := stringField(p, "finishReason"); finish != "" {
		color := shell.ColorText
		if finish == "length" || finish == "content_filter" {
			color = shell.ColorAmber
		}
		b.WriteString(kvRowColored("finish", finish, color, width))
	}
	if tc, ok := p["toolCalls"].([]any); ok && len(tc) > 0 {
		b.WriteString(kvRow("tool calls", fmt.Sprintf("%d", len(tc)), width))
	}
	// Input/output rendered as one-line previews. Full content is in
	// the `i` inspect-raw overlay. Strings come through verbatim
	// (first 60 chars); arrays/objects come through as summary counts.
	if input, ok := p["input"]; ok && input != nil {
		b.WriteString(kvRow("input", valuePreview(input, previewMax(width)), width))
	}
	if output, ok := p["output"]; ok && output != nil {
		b.WriteString(kvRow("output", valuePreview(output, previewMax(width)), width))
	}
	if e := stringField(p, "error"); e != "" {
		b.WriteString(kvRowColored("error", truncate(e, previewMax(width)), shell.ColorRose, width))
	}
	return b.String()
}

func renderFlowPayload(p map[string]any, width int) string {
	var b strings.Builder
	if id := stringField(p, "flowId"); id != "" {
		b.WriteString(kvRow("flow", id, width))
	}
	if step := stringField(p, "stepId"); step != "" {
		label := stringField(p, "stepLabel")
		val := step
		if label != "" {
			val = step + " · " + label
		}
		b.WriteString(kvRow("step", val, width))
	}
	if from := stringField(p, "fromStepId"); from != "" {
		b.WriteString(kvRow("from step", from, width))
	}
	if reason := stringField(p, "resumeReason"); reason != "" {
		b.WriteString(kvRowColored("resume reason", reason, shell.ColorAmber, width))
	}
	if steps, ok := p["stepIds"].([]any); ok && len(steps) > 0 {
		b.WriteString(subSection(fmt.Sprintf("steps · %d", len(steps)), width))
		for _, sid := range steps {
			if s := fmt.Sprintf("%v", sid); s != "" {
				b.WriteString(" · " + shell.TextDim.Render(s) + "\n")
			}
		}
	}
	return b.String()
}

func renderCompositionPayload(p map[string]any, ctype string, width int) string {
	var b strings.Builder
	if ctype != "" {
		b.WriteString(kvRowColored("kind", ctype, shell.ColorViolet, width))
	}
	if id := stringField(p, "compositionId"); id != "" {
		b.WriteString(kvRow("id", id, width))
	}
	if agents, ok := p["agents"].([]any); ok && len(agents) > 0 {
		b.WriteString(subSection(fmt.Sprintf("agents · %d", len(agents)), width))
		for _, a := range agents {
			if m, ok := a.(map[string]any); ok {
				id := stringField(m, "id")
				role := stringField(m, "role")
				line := id
				if role != "" {
					line += " · " + role
				}
				b.WriteString(" · " + shell.Text.Render(line) + "\n")
			}
		}
	}
	if quorum := intField(p, "quorum"); quorum > 0 {
		b.WriteString(kvRow("quorum", fmt.Sprintf("%d", quorum), width))
	}
	if votes, ok := p["votes"].([]any); ok && len(votes) > 0 {
		b.WriteString(subSection(fmt.Sprintf("votes · %d", len(votes)), width))
		for _, v := range votes {
			if m, ok := v.(map[string]any); ok {
				voter := stringField(m, "voter")
				choice := stringField(m, "choice")
				scoreF := floatField(m, "score")
				score := ""
				if scoreF != 0 {
					score = fmt.Sprintf(" %.2f", scoreF)
				}
				b.WriteString(" · " + shell.Text.Render(voter) + " → " +
					shell.TextDim.Render(choice) + shell.Amber.Render(score) + "\n")
			}
		}
	}
	if winner := stringField(p, "winner"); winner != "" {
		b.WriteString(kvRowColored("winner", winner, shell.ColorGreen, width))
	}
	if hops, ok := p["hops"].([]any); ok && len(hops) > 0 {
		b.WriteString(subSection(fmt.Sprintf("hops · %d", len(hops)), width))
		for _, h := range hops {
			if m, ok := h.(map[string]any); ok {
				from := stringField(m, "from")
				to := stringField(m, "to")
				reason := stringField(m, "reason")
				line := from + " → " + to
				if reason != "" {
					line += " · " + reason
				}
				b.WriteString(" · " + shell.Text.Render(line) + "\n")
			}
		}
	}
	return b.String()
}

func renderDelegatePayload(p map[string]any, width int) string {
	var b strings.Builder
	if from := stringField(p, "agent"); from != "" {
		b.WriteString(kvRow("from", from, width))
	}
	if to := stringField(p, "to"); to != "" {
		b.WriteString(kvRowColored("to", to, shell.ColorTeal, width))
	}
	if reason := stringField(p, "reason"); reason != "" {
		b.WriteString(kvRow("reason", truncate(reason, previewMax(width)), width))
	}
	if payload, ok := p["payload"]; ok && payload != nil {
		b.WriteString(kvRow("payload", valuePreview(payload, previewMax(width)), width))
	}
	if ret, ok := p["returnValue"]; ok && ret != nil {
		b.WriteString(kvRow("return", valuePreview(ret, previewMax(width)), width))
	}
	return b.String()
}

func renderHandoffPayload(p map[string]any, width int) string {
	// Matches HandoffPrepareEvent: fromAgent · toAgent · handoffId ·
	// summary · inputSize · outputSize. Curated kv rows; raw payload
	// behind `i` inspect-raw.
	var b strings.Builder
	from := stringField(p, "fromAgent")
	to := stringField(p, "toAgent")
	if from != "" || to != "" {
		// Render the transfer as a single styled row: `from → to`.
		fromStyled := shell.Text.Render(stringOrDash(from))
		toStyled := lipgloss.NewStyle().Foreground(shell.ColorTeal).Render(stringOrDash(to))
		arrow := lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(" → ")
		row := " " + shell.TextDim.Render(padString2("transfer:", 18)) + " " +
			fromStyled + arrow + toStyled
		b.WriteString(padRow(row, width) + "\n")
	}
	if id := stringField(p, "handoffId"); id != "" {
		b.WriteString(kvRow("handoff id", truncate(id, 24), width))
	}
	if summary := stringField(p, "summary"); summary != "" {
		b.WriteString(kvRow("summary", truncate(summary, previewMax(width)), width))
	}
	if inSize := intField(p, "inputSize"); inSize > 0 {
		b.WriteString(kvRow("input size", fmt.Sprintf("%d bytes", inSize), width))
	}
	if outSize := intField(p, "outputSize"); outSize > 0 {
		b.WriteString(kvRow("output size", fmt.Sprintf("%d bytes", outSize), width))
	}
	if payload, ok := p["payload"]; ok && payload != nil {
		b.WriteString(kvRow("payload", valuePreview(payload, previewMax(width)), width))
	}
	return b.String()
}

func stringOrDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func renderRetrievalPayload(p map[string]any, width int) string {
	var b strings.Builder
	if q := stringField(p, "query"); q != "" {
		b.WriteString(kvRow("query", q, width))
	}
	if r := stringField(p, "retrieverId"); r != "" {
		b.WriteString(kvRow("retriever", r, width))
	}
	if k := intField(p, "k"); k > 0 {
		b.WriteString(kvRow("k", fmt.Sprintf("%d", k), width))
	}
	if hits, ok := p["hits"].([]any); ok {
		b.WriteString(subSection(fmt.Sprintf("hits · %d", len(hits)), width))
		max := 5
		if max > len(hits) {
			max = len(hits)
		}
		for i := 0; i < max; i++ {
			if m, ok := hits[i].(map[string]any); ok {
				id := stringField(m, "id")
				score := floatField(m, "score")
				content := stringField(m, "content")
				scoreStr := ""
				if score != 0 {
					scoreStr = fmt.Sprintf("[%.2f] ", score)
				}
				line := shell.Amber.Render(scoreStr) +
					shell.Text.Render(id) +
					"  " +
					shell.TextDim.Render(truncate(content, width-len(id)-12))
				b.WriteString(" · " + line + "\n")
			}
		}
		if len(hits) > max {
			b.WriteString(" · " + shell.TextMuted.Render(
				fmt.Sprintf("+ %d more", len(hits)-max)) + "\n")
		}
	}
	return b.String()
}

func renderEmbedPayload(p map[string]any, width int) string {
	var b strings.Builder
	if m := stringField(p, "model"); m != "" {
		b.WriteString(kvRow("model", m, width))
	}
	if c := intField(p, "count"); c > 0 {
		b.WriteString(kvRow("count", fmt.Sprintf("%d", c), width))
	}
	if d := intField(p, "dim"); d > 0 {
		b.WriteString(kvRow("dim", fmt.Sprintf("%d", d), width))
	}
	if t := intField(p, "tokens"); t > 0 {
		b.WriteString(kvRow("tokens", fmt.Sprintf("%d", t), width))
	}
	return b.String()
}

func renderJudgePayload(p map[string]any, width int) string {
	var b strings.Builder
	if name := stringField(p, "judgeName"); name != "" {
		b.WriteString(kvRow("judge", name, width))
	}
	if s := floatField(p, "score"); s != 0 {
		color := shell.ColorGreen
		if s < 0.6 {
			color = shell.ColorRose
		} else if s < 0.8 {
			color = shell.ColorAmber
		}
		b.WriteString(kvRowColored("score", fmt.Sprintf("%.3f", s), color, width))
	}
	if r := stringField(p, "rationale"); r != "" {
		// One-line preview — full rationale is in the `i` inspect overlay.
		b.WriteString(kvRow("rationale", truncate(r, previewMax(width)), width))
	}
	if subs, ok := p["subScores"].(map[string]any); ok && len(subs) > 0 {
		// Per-metric sub-scores get one row each — these are the
		// individual checks (relevance, factuality, format, etc.).
		keys := make([]string, 0, len(subs))
		for k := range subs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if f, ok := subs[k].(float64); ok {
				color := shell.ColorGreen
				if f < 0.6 {
					color = shell.ColorRose
				} else if f < 0.8 {
					color = shell.ColorAmber
				}
				b.WriteString(kvRowColored(k, fmt.Sprintf("%.3f", f), color, width))
			}
		}
	}
	return b.String()
}

func renderMemoryPayload(p map[string]any, width int) string {
	var b strings.Builder
	if op := stringField(p, "op"); op != "" {
		// memory.read / memory.write — surface which side this span is.
		b.WriteString(kvRowColored("op", op, shell.ColorTeal, width))
	}
	if scope := stringField(p, "scope"); scope != "" {
		b.WriteString(kvRow("scope", scope, width))
	}
	if key := stringField(p, "key"); key != "" {
		b.WriteString(kvRow("key", key, width))
	}
	if v, ok := p["value"]; ok && v != nil {
		b.WriteString(kvRow("value", valuePreview(v, previewMax(width)), width))
	}
	if h := intField(p, "hits"); h > 0 {
		b.WriteString(kvRow("hits", fmt.Sprintf("%d", h), width))
	}
	return b.String()
}

func renderBlackboardPayload(p map[string]any, width int) string {
	var b strings.Builder
	if writer := stringField(p, "writer"); writer != "" {
		b.WriteString(kvRow("writer", writer, width))
	}
	if key := stringField(p, "key"); key != "" {
		b.WriteString(kvRow("key", key, width))
	}
	if v, ok := p["value"]; ok && v != nil {
		b.WriteString(kvRow("value", valuePreview(v, previewMax(width)), width))
	}
	if rev := intField(p, "revision"); rev > 0 {
		b.WriteString(kvRow("revision", fmt.Sprintf("%d", rev), width))
	}
	return b.String()
}

func renderCompactPayload(p map[string]any, width int) string {
	var b strings.Builder
	if s := stringField(p, "strategy"); s != "" {
		b.WriteString(kvRow("strategy", s, width))
	}
	before := intField(p, "tokensBefore")
	after := intField(p, "tokensAfter")
	if before > 0 || after > 0 {
		b.WriteString(kvRow("tokens before", fmt.Sprintf("%d", before), width))
		b.WriteString(kvRow("tokens after", fmt.Sprintf("%d", after), width))
		if before > 0 && after > 0 {
			savedPct := 100.0 * float64(before-after) / float64(before)
			b.WriteString(kvRowColored("saved", fmt.Sprintf("%.0f%%", savedPct), shell.ColorGreen, width))
		}
	}
	return b.String()
}

func renderGenericPayload(p map[string]any, width int) string {
	if len(p) == 0 {
		return ""
	}
	// Stable key order so re-renders don't reshuffle.
	keys := make([]string, 0, len(p))
	for k := range p {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		v := p[k]
		switch t := v.(type) {
		case string:
			b.WriteString(kvRow(k, truncate(t, width-16), width))
		case bool:
			b.WriteString(kvRow(k, fmt.Sprintf("%t", t), width))
		case float64:
			b.WriteString(kvRow(k, fmt.Sprintf("%g", t), width))
		case nil:
			b.WriteString(kvRow(k, shell.TextMuted.Render("—"), width))
		default:
			b.WriteString(kvRow(k, truncate(jsonOneLine(v), width-16), width))
		}
	}
	return b.String()
}

// --- helpers --------------------------------------------------------------

func subSection(label string, width int) string {
	return " " + lipgloss.NewStyle().
		Foreground(shell.ColorTextDim).
		Render(strings.ToUpper(label)) + "\n"
}

func jsonBlock(v any, width int) string {
	pretty := jsonOrString(v)
	return boxedPre(pretty, width-2)
}

// jsonOrString renders a payload value as a string: raw strings pass
// through, everything else is pretty-printed JSON.
func jsonOrString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// valuePreview returns a single-line, human-readable summary of any
// payload value — meant for inline kvRow values in the span detail
// pane. Replaces the JSON-block dumps that used to fill that pane.
//
// Heuristics:
//   - nil               → `—`
//   - bool              → `true` / `false`
//   - number            → `%g`
//   - string            → first `max` chars (truncate-with-ellipsis if longer)
//   - array             → `N items` (or empty bracket for zero)
//   - object/map        → `N keys · {first-key=preview,…}` short summary
//   - other             → fall back to single-line JSON, truncated
//
// The full payload is always reachable via the `i` inspect-raw overlay.
func valuePreview(v any, max int) string {
	if max <= 0 {
		max = 60
	}
	if v == nil {
		return "—"
	}
	switch t := v.(type) {
	case string:
		s := strings.ReplaceAll(t, "\n", " ")
		s = strings.TrimSpace(s)
		if s == "" {
			return `""`
		}
		if len(s) > max {
			return s[:max-1] + "…"
		}
		return s
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		return fmt.Sprintf("%g", t)
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	case []any:
		if len(t) == 0 {
			return "[]"
		}
		return fmt.Sprintf("%d items", len(t))
	case map[string]any:
		if len(t) == 0 {
			return "{}"
		}
		// Show first 1-2 keys + a count for the rest.
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		head := keys[0]
		more := len(keys) - 1
		summary := head
		if more > 0 {
			summary += fmt.Sprintf(" +%d", more)
		}
		return fmt.Sprintf("%d keys · %s", len(keys), summary)
	default:
		one := jsonOneLine(v)
		if len(one) > max {
			return one[:max-1] + "…"
		}
		return one
	}
}

func jsonOneLine(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func stringField(p map[string]any, key string) string {
	if v, ok := p[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
		if v != nil {
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func intField(p map[string]any, key string) int {
	if v, ok := p[key]; ok {
		switch t := v.(type) {
		case int:
			return t
		case int64:
			return int(t)
		case float64:
			return int(t)
		}
	}
	return 0
}

func floatField(p map[string]any, key string) float64 {
	if v, ok := p[key]; ok {
		switch t := v.(type) {
		case float64:
			return t
		case int:
			return float64(t)
		case int64:
			return float64(t)
		}
	}
	return 0
}
