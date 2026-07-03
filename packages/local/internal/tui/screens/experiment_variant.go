package screens

import "github.com/use-crux/crux/packages/local/internal/api"

// bestExperimentVariant returns the variant with the highest pass rate in an
// experiment detail record.
func bestExperimentVariant(detail api.QualityExperimentDetail) string {
	bestName := ""
	bestPass := -1.0
	for name, agg := range detail.Aggregates.PerVariant {
		if agg.PassRate > bestPass {
			bestName = name
			bestPass = agg.PassRate
		}
	}
	return bestName
}
