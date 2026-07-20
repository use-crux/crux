package screens

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func TestRunsInlineClippingAndPaddingUseTerminalCells(t *testing.T) {
	if got := clipRunsInline("éé", 2); got != "éé" {
		t.Fatalf("fitting multibyte text clipped: got %q, want %q", got, "éé")
	}
	if got := padRunsInline("界", 4); got != "界  " || lipgloss.Width(got) != 4 {
		t.Fatalf("wide text padding = %q (%d cells), want %q (4 cells)", got, lipgloss.Width(got), "界  ")
	}
}

func TestRunsPrimitivePayloadPreviewClipsMultibyteTextByTerminalCells(t *testing.T) {
	payload, err := json.Marshal(map[string]string{"error": strings.Repeat("界", 20)})
	if err != nil {
		t.Fatal(err)
	}
	rendered := ansi.Strip(renderPrimitivePayload(api.InspectRunSpan{
		Primitive: api.SpanPrimitiveTool,
		Data:      payload,
	}, 40))
	want := strings.Repeat("界", 7) + "…"
	if !utf8.ValidString(rendered) {
		t.Fatalf("payload preview split multibyte text: %q", rendered)
	}
	if !strings.Contains(rendered, want) {
		t.Fatalf("payload preview did not clip to 16 terminal cells:\n got %q\nwant substring %q", rendered, want)
	}
}

func TestRunsFailedResourceErrorClipsMultibyteTextByTerminalCells(t *testing.T) {
	runs := NewRuns()
	_, token := runs.runsResource.Begin(testContext, runsListOwner, 0)
	runs.runsResource.Apply(resource.ResourceResult[[]api.ObservabilityRunSummary]{
		Token: token,
		Err:   errors.New(strings.Repeat("界", 100)),
	})

	view := viewRunsForTest(runs, Size{Width: 70, Height: 24})
	if !utf8.ValidString(view) {
		t.Fatalf("failed-resource view split multibyte text: %q", view)
	}
	lines := strings.Split(ansi.Strip(view), "\n")
	for index, line := range lines {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("failed-resource line %d width = %d, want at most 70: %q", index+1, width, line)
		}
	}
	if !strings.Contains(ansi.Strip(view), "…") {
		t.Fatalf("failed-resource view did not expose truncation: %q", view)
	}
}

func TestRunsSanitizesHostileRuntimeTextBeforeRendering(t *testing.T) {
	hostile := "\x1b]8;;https://evil.invalid\x07visible\x1b]8;;\x07" +
		"\x1b]0;hostile-title\x07\x1b]52;c;Y2xpcGJvYXJk\x07" +
		"\x1b[31mred\x1b[0m\r\n\t\x00\u0085SAFE" + strings.Repeat("界", 80) + "┌─┬│└─┴"
	duration := 100.0
	payload, err := json.Marshal(map[string]any{"toolName": hostile, "result": hostile})
	if err != nil {
		t.Fatal(err)
	}
	span := api.InspectRunSpan{
		ID:               "span-" + hostile,
		Kind:             hostile,
		Op:               hostile,
		Primitive:        api.SpanPrimitiveTool,
		Name:             "activity-" + hostile,
		Status:           hostile,
		DurationMs:       &duration,
		Attributes:       map[string]string{hostile: hostile},
		Data:             payload,
		LinkedInsightIDs: []string{hostile},
	}
	runID := "run-" + hostile
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{
		RunID: runID, Name: "run-" + hostile, RootPrimitive: hostile, Status: hostile,
	})
	setRunDiagnosisForTest(runs, runDiagnosisFixture{
		RunID: runID, Name: "run-" + hostile, Status: hostile, DurationMs: duration,
		Model: "model-" + hostile, Provider: "provider-" + hostile, Spans: []api.InspectRunSpan{span},
	})
	runs.diagnosis.Failures = []FailureItem{{NodeID: span.ID, Message: "failure-" + hostile}}
	runs.diagnosis.Diagnostics = []DiagnosisItem{{NodeID: span.ID, Diagnostic: observability.RunDetailDiagnostic{
		Code: hostile, Severity: hostile, Message: "diagnostic-" + hostile, SuggestedFix: "fix-" + hostile,
	}}}
	runs.diagnosis.Artifacts = []ArtifactItem{{NodeID: span.ID, Artifact: observability.ArtifactSummary{
		ArtifactID: "artifact-" + hostile, Kind: hostile,
	}}}
	runs.diagnosis.Events = []EventItem{{NodeID: span.ID, Event: observability.SpanEventSummary{
		EventID: "event-" + hostile, Name: hostile,
	}}}
	selectRunForTest(runs, runID)
	selectSpanForTest(runs, span.ID)
	runs.focus = focusSpanDetail

	view := viewRunsForTest(runs, Size{Width: 160, Height: 45})
	document := runs.renderSpanDetailDocument(runs.currentSpan(), 70)
	path, _ := runs.Breadcrumb()
	assertSafeRunsText(t, "view", view)
	assertSafeRunsText(t, "detail document", document)
	assertSafeRunsText(t, "breadcrumb", strings.Join(path, " / "))

	plain := ansi.Strip(view)
	for _, visible := range []string{"visible", "red", "SAFE"} {
		if !strings.Contains(plain, visible) {
			t.Fatalf("sanitized Runs view lost visible safe text %q:\n%s", visible, plain)
		}
	}
	lines := strings.Split(plain, "\n")
	if len(lines) != 45 {
		t.Fatalf("hostile Runs line count = %d, want 45", len(lines))
	}
	for index, line := range lines {
		if width := lipgloss.Width(line); width != 160 {
			t.Fatalf("hostile Runs line %d width = %d, want 160: %q", index+1, width, line)
		}
	}
}

func TestRunsHostileRawInspectAndExportRemainLossless(t *testing.T) {
	const hostile = "\x1b]52;c;Y2xpcGJvYXJk\x07raw\r\n\t\x00\u0085界┌─┐"
	payload, err := json.Marshal(map[string]string{"value": hostile})
	if err != nil {
		t.Fatal(err)
	}

	inspectRuns := NewRuns()
	setRunDiagnosisForTest(inspectRuns, runDiagnosisFixture{Spans: []api.InspectRunSpan{{
		ID: "span-raw", Name: "raw", Data: payload,
	}}})
	selectSpanForTest(inspectRuns, "span-raw")
	inspect := inspectRuns.openInspect()
	if inspect == nil {
		t.Fatal("hostile raw span did not enable inspect")
	}
	inspectMessage := inspect()
	request, ok := inspectMessage.(InspectRequest)
	if !ok {
		t.Fatalf("inspect message = %T, want InspectRequest", inspectMessage)
	}
	if !bytes.Equal(request.Payload, payload) {
		t.Fatalf("inspect payload changed:\n got %q\nwant %q", request.Payload, payload)
	}

	home := t.TempDir()
	t.Setenv("HOME", home)
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-raw"},
		Root: api.ObservabilityRunDetailNode{
			ID: "root", SpanSummary: observability.SpanSummary{Attributes: payload, Error: payload},
		},
	}
	exportRuns := NewRuns()
	setRunsForTest(exportRuns, detail.Run)
	selectRunForTest(exportRuns, detail.Run.RunID)
	setRunDetailForTest(exportRuns, detail)
	export := exportRuns.exportRun()
	if export == nil {
		t.Fatal("hostile raw run did not enable export")
	}
	exportMessage := export()
	saved, ok := exportMessage.(runExportedMsg)
	if !ok {
		t.Fatalf("export message = %T, want runExportedMsg", exportMessage)
	}
	body, err := os.ReadFile(saved.path)
	if err != nil {
		t.Fatal(err)
	}
	var decoded api.ObservabilityRunDetail
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	for label, raw := range map[string]json.RawMessage{"attributes": decoded.Root.Attributes, "error": decoded.Root.Error} {
		var value map[string]string
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("decode exported %s: %v", label, err)
		}
		if value["value"] != hostile {
			t.Fatalf("exported %s changed hostile value: got %q, want %q", label, value["value"], hostile)
		}
	}
}

func assertSafeRunsText(t *testing.T, label, value string) {
	t.Helper()
	for _, payload := range []string{"evil.invalid", "hostile-title", "Y2xpcGJvYXJk"} {
		if strings.Contains(value, payload) {
			t.Fatalf("%s retained terminal-control payload %q: %q", label, payload, value)
		}
	}
	for _, char := range ansi.Strip(value) {
		if char != '\n' && unicode.IsControl(char) {
			t.Fatalf("%s retained unsafe rune U+%04X: %q", label, char, value)
		}
	}
}
