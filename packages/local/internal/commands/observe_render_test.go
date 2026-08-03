package commands

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// The observe commands (cost/index/lint/inspect/traces/flows) share one
// contract under spec 03 §3: a branded "◇ crux <command>" header and a colorless
// invariant when color is disabled (every styled span funnels through
// output.IO). forceAsciiProfile (quality_read_render_test.go) pins the global
// lipgloss profile so output.Table's own header/separator stay escape-free too.

func TestFlowsRendererColorlessAndBranded(t *testing.T) {
	forceAsciiProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printFlows(io, []api.RuntimeFlowRun{
		{Name: "ingest", Status: "success", SessionID: "sess-abcdef0123456789", StartedAt: 1700000000000},
	})
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless flows output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"◇ crux flows", "TIME", "NAME", "STATUS", "ingest", "✓"} {
		if !strings.Contains(got, want) {
			t.Errorf("flows output missing %q:\n%s", want, got)
		}
	}
}

func TestCostRendererColorlessAndBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printCost(io, []api.CostEvent{
		{Report: map[string]any{
			"total":   map[string]any{"cost": 0.1234},
			"byModel": map[string]any{"gpt-4": map[string]any{"cost": 0.1}},
		}},
		{Kind: "warn", Threshold: f64(0.5), Actual: f64(0.6)},
	})
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless cost output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"◇ crux cost", "Total:", "By model", "gpt-4", "warn"} {
		if !strings.Contains(got, want) {
			t.Errorf("cost output missing %q:\n%s", want, got)
		}
	}
}

func TestCostRendererEmptyStillBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printCost(io, nil)
	got := out.String()

	if !strings.Contains(got, "◇ crux cost") || !strings.Contains(got, "No cost events recorded") {
		t.Errorf("empty cost should still print a branded header and an honest empty line:\n%s", got)
	}
}

func TestLintRendererColorlessAndBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printLintFindings(io, []api.IndexLintFinding{
		{
			Severity: "error", Title: "Missing description", RuleID: "rule.desc",
			Message: "prompt has no description", PrimaryDefinitionID: "my.prompt",
			Source: &api.SourceLoc{File: "a.eval.ts", Line: 5},
		},
	}, "recommended", false)
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless lint output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{
		"◇ crux lint", "Profile:", "recommended", "Findings:",
		"error", "Missing description", "rule.desc", "my.prompt",
		"a.eval.ts:5", "prompt has no description",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("lint output missing %q:\n%s", want, got)
		}
	}
}

func TestLintRendererEmptyStillBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printLintFindings(io, nil, "recommended", false)
	got := out.String()

	if !strings.Contains(got, "◇ crux lint") || !strings.Contains(got, "No lint findings.") {
		t.Errorf("empty lint should still print a branded header and an honest empty line:\n%s", got)
	}
}

func TestInspectRendererColorlessAndBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	found := &api.ObservabilityRunSummary{RunID: "run_123", Model: "openai/gpt-4o", PromptID: "my.prompt"}
	printInspect(io, "my.prompt", found, api.ObservabilityRunDetail{})
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless inspect output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"◇ crux inspect", "my.prompt", "From run:", "run_123", "Model:", "openai/gpt-4o"} {
		if !strings.Contains(got, want) {
			t.Errorf("inspect output missing %q:\n%s", want, got)
		}
	}
}

func TestIndexRendererColorlessAndBranded(t *testing.T) {
	forceAsciiProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	desc := "redacts PII"
	printIndex(io, api.IndexData{
		Prompts: []api.PromptMeta{{ID: "strip.pii", Description: &desc, Tags: []string{"safety"}}},
	}, "")
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless index output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"◇ crux index", "Prompts", "strip.pii", "redacts PII", "safety"} {
		if !strings.Contains(got, want) {
			t.Errorf("index output missing %q:\n%s", want, got)
		}
	}
}

func TestIndexRendererEmptyStillBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printIndex(io, api.IndexData{}, "")
	got := out.String()

	if !strings.Contains(got, "◇ crux index") || !strings.Contains(got, "No Catalog definitions found") {
		t.Errorf("empty index should still print a branded header and an honest empty line:\n%s", got)
	}
	if strings.Contains(got, "sent an index event") {
		t.Errorf("empty index retained obsolete event-registration guidance:\n%s", got)
	}
}

func TestIndexCatalogCompatibilityRenderersUseIndexChrome(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	catalog := api.CatalogListV1{Definitions: []api.CatalogListDefinitionV1{{
		ID: "prompt:demo.support", Kind: "prompt",
	}}}
	printCatalogListWithHeader(io, catalog, "index")
	if !strings.Contains(out.String(), "◇ crux index") || strings.Contains(out.String(), "◇ crux catalog") {
		t.Fatalf("index list chrome = %q", out.String())
	}

	out.Reset()
	printCatalogDefinitionWithHeader(io, api.CatalogDefinitionV1{
		Definition: api.ProjectDefinition{ID: "prompt:demo.support", Kind: "prompt"},
	}, "index show")
	if !strings.Contains(out.String(), "◇ crux index show") || strings.Contains(out.String(), "◇ crux catalog show") {
		t.Fatalf("index show chrome = %q", out.String())
	}
}

func TestInspectAcceptsBareAndPromptPrefixedIDs(t *testing.T) {
	for _, input := range []string{"demo.support", "prompt:demo.support"} {
		if got := normalizeInspectPromptID(input); got != "demo.support" {
			t.Fatalf("normalizeInspectPromptID(%q) = %q", input, got)
		}
	}
}

func TestTracesRendererColorlessAndBranded(t *testing.T) {
	forceAsciiProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printTraces(io, []api.ObservabilityRunSummary{
		{Status: "ok", PromptID: "my.prompt", Model: "openai/gpt-4o", StartedAt: "2026-06-16T10:00:00Z"},
	})
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless traces output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{"◇ crux traces", "TIME", "STATUS", "PROMPT", "my.prompt", "✓"} {
		if !strings.Contains(got, want) {
			t.Errorf("traces output missing %q:\n%s", want, got)
		}
	}
}

func TestTracesRendererEmptyStillBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printTraces(io, nil)
	got := out.String()

	if !strings.Contains(got, "◇ crux traces") || !strings.Contains(got, "No traces found.") {
		t.Errorf("empty traces should still print a branded header and an honest empty line:\n%s", got)
	}
}

func TestFlowsRendererEmptyStillBranded(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	printFlows(io, nil)
	got := out.String()

	if !strings.Contains(got, "◇ crux flows") || !strings.Contains(got, "No runtime flows found.") {
		t.Errorf("empty flows should still print a branded header and an honest empty line:\n%s", got)
	}
}
