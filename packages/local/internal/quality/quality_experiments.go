package quality

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func buildQualityScorers(dir string) ([]qualityScorerRecord, error) {
	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		return nil, err
	}
	experiments := snapshot.Experiments
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

func enrichQualityExperiment(experiment qualityExperimentRecord) qualityExperimentRecord {
	return qualityfs.EnrichExperiment(experiment)
}
