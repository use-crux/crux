package quality

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

func buildQualityScorers(dir string) ([]qualityScorerRecord, error) {
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
	type aggregate struct {
		kind       string
		suiteIDs   []string
		runCount   int
		passCount  int
		scoreSum   float64
		scoreCount int
		lastUsedAt string
	}
	byName := map[string]aggregate{}
	for _, experiment := range experiments {
		usedAt := nonEmptyString(experiment.EndedAt, experiment.StartedAt)
		for _, testCase := range experiment.Cases {
			for _, score := range testCase.Scores {
				if score.Name == "" {
					continue
				}
				current := byName[score.Name]
				current.kind = nonEmptyString(score.Kind, "numeric")
				current.suiteIDs = appendUniqueString(current.suiteIDs, experiment.Suite.ID)
				current.runCount++
				if score.Value != nil {
					current.scoreSum += *score.Value
					current.scoreCount++
					if *score.Value >= 0.5 {
						current.passCount++
					}
				}
				if usedAt > current.lastUsedAt {
					current.lastUsedAt = usedAt
				}
				byName[score.Name] = current
			}
		}
	}
	names := []string{}
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	scorers := make([]qualityScorerRecord, 0, len(names))
	for _, name := range names {
		current := byName[name]
		var passRate *float64
		var meanScore *float64
		if current.scoreCount > 0 {
			pass := float64(current.passCount) / float64(current.scoreCount)
			mean := current.scoreSum / float64(current.scoreCount)
			passRate = &pass
			meanScore = &mean
		}
		scorers = append(scorers, qualityScorerRecord{
			Tag:        "QualityScorer",
			Name:       name,
			Kind:       current.kind,
			SuiteIDs:   current.suiteIDs,
			RunCount:   current.runCount,
			PassRate:   passRate,
			MeanScore:  meanScore,
			LastUsedAt: current.lastUsedAt,
		})
	}
	return scorers, nil
}

func readQualityExperiment(dir string, id string) (qualityExperimentRecord, error) {
	content, err := os.ReadFile(filepath.Join(dir, "experiments", safeQualityFileName(id)+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return qualityExperimentRecord{}, fmt.Errorf("quality experiment %q not found", id)
		}
		return qualityExperimentRecord{}, err
	}
	var experiment qualityExperimentRecord
	if err := json.Unmarshal(content, &experiment); err != nil {
		return qualityExperimentRecord{}, err
	}
	return experiment, nil
}

func readQualityExperimentRecords(dir string) ([]qualityExperimentRecord, error) {
	raw, err := readQualityRecords(dir, "experiments")
	if err != nil {
		return nil, err
	}
	experiments := make([]qualityExperimentRecord, 0, len(raw))
	for _, item := range raw {
		var experiment qualityExperimentRecord
		if err := json.Unmarshal(item, &experiment); err != nil {
			return nil, err
		}
		experiments = append(experiments, enrichQualityExperiment(experiment))
	}
	return experiments, nil
}

func enrichQualityExperiment(experiment qualityExperimentRecord) qualityExperimentRecord {
	if experiment.VariantConfigs == nil {
		experiment.VariantConfigs = map[string]qualityVariantConfigDiff{}
	}
	byVariant := map[string][]qualityExperimentCase{}
	for _, testCase := range experiment.Cases {
		byVariant[testCase.VariantID] = append(byVariant[testCase.VariantID], testCase)
	}
	if len(experiment.Variants) == 0 {
		for variantID := range byVariant {
			experiment.Variants = append(experiment.Variants, qualityExperimentVariant{ID: variantID, TargetID: variantID})
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
				tokens += float64(qualityIntFromAny(extractJSONField(testCase.Output, "tokenCount")))
				if value := qualityOptionalFloat(extractJSONField(testCase.Output, "cost")); value != nil {
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
		experiment.Variants[bestIndex].IsWinner = true
	}
	if experiment.Status == "running" {
		experiment.Progress = &qualityExperimentProgress{
			CasesDone:     len(experiment.Cases),
			CasesTotal:    experiment.Summary.Total,
			VariantsTotal: len(experiment.Variants),
			ProviderCalls: len(experiment.Cases),
		}
	}
	return experiment
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

func qualityIntFromAny(value any) int {
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

func qualityOptionalFloat(value any) *float64 {
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
