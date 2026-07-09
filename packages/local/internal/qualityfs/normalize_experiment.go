package qualityfs

import (
	"encoding/json"
	"sort"
)

func enrichExperiment(experiment Experiment) Experiment {
	if experiment.VariantConfigs == nil {
		experiment.VariantConfigs = map[string]VariantConfigDiff{}
	}
	byVariant := map[string][]ExperimentCase{}
	cells := experimentCells(experiment)
	for _, testCase := range cells {
		byVariant[testCase.VariantID] = append(byVariant[testCase.VariantID], testCase)
	}
	if len(experiment.Variants) == 0 {
		for variantID := range byVariant {
			experiment.Variants = append(experiment.Variants, ExperimentVariant{ID: variantID, TargetID: variantID})
		}
		sort.Slice(experiment.Variants, func(i, j int) bool { return experiment.Variants[i].ID < experiment.Variants[j].ID })
	}
	bestIndex := -1
	bestPassRate := -1.0
	baselinePassRate := 0.0
	hasBaseline := false
	for index := range experiment.Variants {
		variant := &experiment.Variants[index]
		cases := byVariant[variant.ID]
		if variant.TargetID == "" {
			variant.TargetID = variant.ID
		}
		passed := 0
		scores := []float64{}
		latencies := []float64{}
		for _, testCase := range cases {
			if testCase.Status == "passed" || testCase.Status == "success" {
				passed++
			}
			if testCase.DurationMs > 0 {
				latencies = append(latencies, testCase.DurationMs)
			}
			for _, score := range testCase.Scores {
				if experiment.PrimaryScore == "" && score.Kind == "numeric" && score.Name != "" {
					experiment.PrimaryScore = score.Name
				}
				if score.Value != nil {
					scores = append(scores, *score.Value)
				}
			}
		}
		if len(cases) > 0 {
			passRate := float64(passed) / float64(len(cases))
			variant.PassRate = &passRate
			if variant.IsBaseline || index == 0 {
				baselinePassRate = passRate
				hasBaseline = true
			}
			if passRate > bestPassRate {
				bestPassRate = passRate
				bestIndex = index
			}
		}
		if len(scores) > 0 {
			mean := meanFloat64(scores)
			variant.MeanScore = &mean
		}
		variant.LatencyP95Ms = percentile(latencies, 0.95)
		if len(cases) > 0 {
			tokens := 0.0
			cost := 0.0
			costCount := 0
			for _, testCase := range cases {
				tokens += float64(intFromAny(extractJSONField(testCase.Output, "tokenCount")))
				if value := optionalFloat(extractJSONField(testCase.Output, "cost")); value != nil {
					cost += *value
					costCount++
				}
			}
			if tokens > 0 {
				avg := tokens / float64(len(cases))
				variant.TokensAvg = &avg
			}
			if costCount > 0 {
				variant.CostTotal = &cost
			}
		}
	}
	if hasBaseline {
		for index := range experiment.Variants {
			if experiment.Variants[index].PassRate != nil {
				delta := (*experiment.Variants[index].PassRate - baselinePassRate) * 100
				experiment.Variants[index].BaselineDeltaPassPts = &delta
			}
		}
	}
	if bestIndex >= 0 {
		for index := range experiment.Variants {
			experiment.Variants[index].IsWinner = false
		}
		experiment.Variants[bestIndex].IsWinner = true
	}
	if experiment.Status == "running" {
		experiment.Progress = &ExperimentProgress{
			CasesDone:     len(cells),
			CasesTotal:    experiment.Summary.Total,
			VariantsTotal: len(experiment.Variants),
			ProviderCalls: len(cells),
		}
	}
	return experiment
}

func EnrichExperiment(experiment Experiment) Experiment {
	return enrichExperiment(experiment)
}

func extractJSONField(value any, key string) any {
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case map[string]any:
		return typed[key]
	default:
		data, err := json.Marshal(value)
		if err != nil {
			return nil
		}
		var obj map[string]any
		if err := json.Unmarshal(data, &obj); err != nil {
			return nil
		}
		return obj[key]
	}
}

func meanFloat64(values []float64) float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func percentile(values []float64, p float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	index := int(float64(len(values)-1) * p)
	value := values[index]
	return &value
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		number, err := typed.Int64()
		if err == nil {
			return int(number)
		}
	}
	return 0
}

func optionalFloat(value any) *float64 {
	switch typed := value.(type) {
	case float64:
		return &typed
	case int:
		next := float64(typed)
		return &next
	case json.Number:
		next, err := typed.Float64()
		if err == nil {
			return &next
		}
	}
	return nil
}
