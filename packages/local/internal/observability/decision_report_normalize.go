package observability

func normalizeTurnDecisionReportCollections(report *TurnDecisionReport) {
	if report == nil {
		return
	}
	if report.Saw == nil {
		report.Saw = []TurnSawItem{}
	}
	if report.Considered == nil {
		report.Considered = []TurnConsideredItem{}
	}
	if report.Freshness == nil {
		report.Freshness = []TurnFreshnessEvidence{}
	}
	if report.Cache == nil {
		report.Cache = []TurnCacheEvidence{}
	}
	if report.Decisions == nil {
		report.Decisions = []TurnDecision{}
	}
	if report.Source == nil {
		report.Source = []TurnSourceGroup{}
	}
	for index := range report.Source {
		if report.Source[index].Items == nil {
			report.Source[index].Items = []TurnSourceJoin{}
		}
	}
	if report.Coverage.Areas == nil {
		report.Coverage.Areas = []TurnCoverageArea{}
	}
	if report.Gaps == nil {
		report.Gaps = []TurnDecisionDiagnostic{}
	}
}
