package readmodel

import "github.com/use-crux/crux/packages/local/internal/store"

func qualityCoverageTargets(relations []store.ProjectRelation) map[string][]string {
	targets := map[string][]string{}
	for _, rel := range relations {
		if rel.Type != "eval.covers_definition" || rel.From == "" || rel.To == "" {
			continue
		}
		evalID := definitionLocalID(rel.From)
		targets[evalID] = appendQualityUniqueString(targets[evalID], rel.To)
		if safe := safeQualityIndexID(evalID); safe != evalID {
			targets[safe] = appendQualityUniqueString(targets[safe], rel.To)
		}
	}
	return targets
}

func evaluationQualityDefinitionIDs(experiment qualityExperimentRecord) []string {
	if experiment.EvaluationID == "" {
		return nil
	}
	return candidateQualityDefinitionIDs("evaluation", experiment.EvaluationID)
}

func coveredQualityTargetIDs(experiment qualityExperimentRecord, coverageByEvalID map[string][]string) []string {
	if experiment.EvaluationID == "" || len(coverageByEvalID) == 0 {
		return nil
	}
	out := []string{}
	for _, evalID := range []string{experiment.EvaluationID, safeQualityIndexID(experiment.EvaluationID)} {
		for _, defID := range coverageByEvalID[evalID] {
			out = appendQualityUniqueString(out, defID)
		}
	}
	return out
}

func addProtectedQualityLinks(defByID map[string]*store.ProjectDefinition, coverageByEvalID map[string][]string) {
	for evalID, targetIDs := range coverageByEvalID {
		if evalID == "" {
			continue
		}
		for _, targetID := range targetIDs {
			def := defByID[targetID]
			if def == nil {
				continue
			}
			q := ensureDefinitionQuality(def)
			q.EvalIDs = appendQualityUniqueString(q.EvalIDs, evalID)
		}
	}
}

func qualityEvaluationCandidateIDs(evalID string) []string {
	out := []string{}
	for _, prefix := range []string{"evaluation", "eval.prompt", "eval.flow", "eval.rag"} {
		out = append(out, candidateQualityDefinitionIDs(prefix, evalID)...)
	}
	return out
}
