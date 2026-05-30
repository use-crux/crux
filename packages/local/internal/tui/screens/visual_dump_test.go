package screens

import (
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// dumpVisualSnapshots is a one-off harness that writes each screen's
// rendered View() output to a file for side-by-side inspection
// against the V1 Panels design screenshots. Set DUMP_VISUAL=1 to run.
// Intentionally not a regression test — output is for the eye, not
// for assertions.
func TestDumpVisualSnapshots(t *testing.T) {
	if os.Getenv("DUMP_VISUAL") != "1" {
		t.Skip("set DUMP_VISUAL=1 to render visual snapshots")
	}
	size := Size{Width: 160, Height: 38}

	write := func(name, body string) {
		path := "/tmp/visual-" + name + ".txt"
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		t.Logf("wrote %s", path)
	}

	// Overview with realistic mock data.
	pass := 0.88
	p95 := 12700.0
	cost := 2.41
	insightSparkline := []int{5, 6, 5, 7, 7, 8, 8}
	o := NewOverview()
	o.loaded = true
	o.overview = api.QualityOverviewRecord{
		InsightCount:              8,
		PassRate:                  &pass,
		P95LatencyMs:              &p95,
		CostPer100Runs:            &cost,
		PassRateHistory:           []float64{0.96, 0.94, 0.93, 0.91, 0.88, 0.89, 0.88, 0.87, 0.85, 0.88, 0.87, 0.88, 0.87, 0.88},
		OpenInsightsHistory:       insightSparkline,
		PassRateSpark:             []float64{0.96, 0.93, 0.91, 0.88, 0.85, 0.88, 0.88},
		CostSpark:                 []float64{0.55, 0.62, 0.81, 1.4, 1.9, 2.2, 2.41},
		LatencySpark:              []float64{4400, 6800, 8200, 9700, 11200, 12200, 12700},
		OpenInsightSeverityCounts: map[string]int{"high": 3, "med": 3, "low": 2},
		RecentRuns: []api.QualityRunRecord{
			{TraceID: "91cc088aaaa", TargetID: "docs_agent", DurationMs: ptrF(12400), TokenCount: 18100, StartedAt: 1716730000000},
			{TraceID: "7d2a014bbbb", TargetID: "docs_agent", DurationMs: ptrF(900), StartedAt: 1716729000000},
			{TraceID: "3d1822bcccc", TargetID: "triage", DurationMs: ptrF(4200), TokenCount: 5800, StartedAt: 1716728500000},
		},
	}
	o.insights = []api.QualityInsightRecord{
		{InsightID: "INS-014", Title: "docs_agent loops 5-16 iterations searching variants of the same concept", Severity: "high", Tags: []string{"agent-loop"}, TargetID: "docs_agent", Trend: []float64{2, 3, 4, 5, 6, 8}, OccurrenceCount: 24, UpdatedAt: "2m"},
		{InsightID: "INS-013", Title: "Token spend 4.2x baseline on triage", Severity: "high", Tags: []string{"cost-spike"}, TargetID: "triage", Trend: []float64{1, 2, 2, 3, 4, 4}, UpdatedAt: "14m"},
		{InsightID: "INS-007", Title: "qa_eval 96% → 88% vs baseline-014", Severity: "high", Tags: []string{"regression"}, TargetID: "qa_eval", UpdatedAt: "6h"},
		{InsightID: "INS-012", Title: "p95 latency +1.8s after gpt-5 swap", Severity: "med", Tags: []string{"latency"}, TargetID: "writer", UpdatedAt: "38m"},
		{InsightID: "INS-011", Title: "14% zero-hit cluster", Severity: "low", Tags: []string{"retrieval"}, TargetID: "rag.search", UpdatedAt: "1h"},
	}
	write("overview", o.View(size))

	// Insights detail.
	i := NewInsights()
	i.items = o.insights
	i.selectedID = "INS-014"
	i.loaded = true
	write("insights", i.View(size))

	// Runs with a trace.
	r := NewRuns()
	r.loaded = true
	r.runs = o.overview.RecentRuns
	r.selRun = "91cc088aaaa"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "91cc088aaaa", TargetID: "docs_agent", DurationMs: ptrF(12400), TokenCount: 18100},
		Spans: []api.QualityRunSpan{
			{ID: "sp1", Name: "docs_agent.run", Primitive: "agent", DurationMs: ptrF(14200)},
			{ID: "sp2", Name: "plan", Primitive: "llm", DurationMs: ptrF(620), ParentID: "sp1"},
			{ID: "sp3", Name: "retrieve (loop)", Primitive: "agent", DurationMs: ptrF(9800), ParentID: "sp1"},
		},
		Trace: api.QualityTraceRecord{StartedAt: 1716730000000},
	}
	r.selSpan = "sp3"
	r.focus = focusSpanDetail
	write("runs", r.View(size))

	// Experiments.
	exp := NewExperiments()
	exp.items = []api.QualityExperimentRecord{sampleExperiment()}
	exp.selectedID = "exp-843"
	exp.loaded = true
	exp.focus = expFocusDetail
	write("experiments", exp.View(size))

	// Compare.
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.selectedCase = "rag/typed_prompts_definition"
	c.loaded = true
	write("compare", c.View(size))

	// Suites.
	d := NewDatasets()
	d.loaded = true
	d.items = []api.QualitySuiteRecord{
		{
			SuiteID: "agent-loops", Name: "agent-loops",
			Cases: []api.QualitySuiteCase{
				{CaseID: "case-001", Tags: []string{"rag", "docs", "typed-prompts"}},
				{CaseID: "case-002", Tags: []string{"agent", "loop"}},
			},
		},
		{SuiteID: "core-300", Name: "core-300", Cases: make([]api.QualitySuiteCase, 300)},
	}
	d.selectedID = "agent-loops"
	d.selectedCase = "case-001"
	write("suites", d.View(size))

	// Cassettes.
	cs := NewCassettes()
	cs.loaded = true
	cs.items = []api.QualityCassetteRecord{
		{Path: "fixtures/docs_agent.cassette", EntryCount: 142},
		{Path: "fixtures/triage.cassette", EntryCount: 98, MissingCount: 4, MismatchCount: 1},
	}
	cs.selectedPath = "fixtures/triage.cassette"
	write("cassettes", cs.View(size))

	// Catalog.
	cat := NewCatalog()
	changed := true
	cat.SetCatalogForTest(api.CatalogData{
		Definitions: []api.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer.prompt", Fidelity: "resolved",
				Quality: &api.CatalogQuality{
					AffectedEvalIDs: []string{"writer-eval"}, AffectedSuiteIDs: []string{"regression"},
					ChangedSinceBaseline: &changed,
					BaselineFingerprint:  "fp-old-9876", CurrentFingerprint: "fp-new-1234",
				}},
			{ID: "agent:docs_agent", Kind: "agent", Name: "docs_agent", Fidelity: "resolved"},
		},
	})
	write("catalog", cat.View(size))
}

func ptrF(v float64) *float64 { return &v }
