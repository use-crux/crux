package uitest

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// DatasetSuites returns mockup-shaped Quality suites for the Datasets screen.
func (c *FixtureClient) DatasetSuites(context.Context) ([]api.QualitySuiteRecord, error) {
	pass := true
	fail := false
	return []api.QualitySuiteRecord{
		{
			Tag:       "QualitySuite",
			SuiteID:   "agent-loops",
			Name:      "agent-loops",
			Source:    "INS-014",
			State:     "draft",
			CaseCount: 4,
			Tags:      []string{"retrieval", "agent-loop"},
			Cases: []api.QualitySuiteCase{
				{
					CaseID:         "case-001",
					Name:           "rag/typed_prompts_definition",
					Input:          "Explain typed prompts in Crux. Cite the docs.",
					Expected:       "# Must include:\n- definition of typed prompts in terms of TS signatures\n- mention of input / output / tools / config\n- at least 1 citation to docs/typed-prompts\n- score >= 0.8 on citation_validity",
					Tags:           []string{"retrieval", "docs", "typed-prompts"},
					Origin:         map[string]any{"trace": "8af2f1c", "insight": "INS-014"},
					FeedbackRating: "thumb-down",
					Assertions: []api.QualitySuiteAssertion{
						{Op: "contains", Arg: "typed prompt", LastPass: &pass},
						{Op: "citation_validity", Arg: ">= 0.8", LastPass: &pass},
						{Op: "rubric_score", Arg: ">= 0.8", LastPass: &fail},
					},
				},
				{CaseID: "case-002", Name: "agent/handoff_loop", Tags: []string{"agent", "loop"}},
				{CaseID: "case-003", Name: "agent/loop_detection", Tags: []string{"agent", "loop"}},
				{CaseID: "case-004", Name: "rag/cassette_replay", Tags: []string{"cassette", "rag"}},
			},
		},
		{
			Tag:       "QualitySuite",
			SuiteID:   "core-300",
			Name:      "core-300",
			Source:    "curated",
			State:     "pinned",
			CaseCount: 300,
		},
		{
			Tag:       "QualitySuite",
			SuiteID:   "cite-quality",
			Name:      "cite-quality",
			Source:    "feedback",
			State:     "live",
			CaseCount: 96,
		},
	}, nil
}
