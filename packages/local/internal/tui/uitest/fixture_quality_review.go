package uitest

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (c *FixtureClient) fixtureCassettes() []api.QualityCassetteFileRecord {
	return []api.QualityCassetteFileRecord{
		{
			Name:       "fixtures/triage",
			Path:       ".crux/quality/cassettes/fixtures/triage.json",
			RecordedAt: c.Now.Add(-15 * time.Hour).UTC().Format("2006-01-02T15:04:05Z"),
			SdkVersion: "0.7.0",
			Models:     []string{"gpt-5"},
			EntryCount: 98,
			Stale:      true,
			SizeBytes:  819200,
		},
	}
}

func (c *FixtureClient) fixtureFeedback() []api.QualityFeedbackRecord {
	traceID := "8af2f1c"
	caseID := "rag/typed_prompts_definition"
	rating := -1
	comment := "Missing citations after retrieval loop; expected the typed prompts definition link."
	return []api.QualityFeedbackRecord{
		{
			Tag:       "QualityFeedback",
			ID:        "fb-014",
			QualityID: "local",
			CreatedAt: c.Now.Add(-35 * time.Minute).UTC().Format("2006-01-02T15:04:05Z"),
			Status:    "open",
			TraceID:   &traceID,
			CaseID:    &caseID,
			Rating:    &rating,
			Comment:   &comment,
			Expected: map[string]interface{}{
				"citation_required": true,
			},
			Tags: []string{"retrieval", "citation"},
		},
	}
}

func (c *FixtureClient) fixtureBaselines() []api.QualityPromotedBaseline {
	return []api.QualityPromotedBaseline{
		{
			SchemaVersion:     1,
			BaselineID:        "baseline-014",
			EvaluationID:      "agent-loops",
			ExperimentID:      "exp-043",
			VariantName:       "maxIter+dedupe",
			PromotedAt:        c.Now.Add(-72 * time.Hour).UTC().Format("2006-01-02T15:04:05Z"),
			PromotedBy:        "quality.promote",
			ConfigFingerprint: "cfg-typed-prompts",
			Reference: map[string]map[string]float64{
				"rag/typed_prompts_definition": {
					"pass":  0.97,
					"score": 0.82,
				},
			},
		},
	}
}
