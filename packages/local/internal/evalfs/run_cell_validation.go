package evalfs

import "fmt"

type scorerContract struct {
	Name                *string `json:"name"`
	ContractFingerprint *string `json:"contractFingerprint"`
}

type cellTimeoutContract struct {
	Budget   *string  `json:"budget"`
	LimitMS  *float64 `json:"limitMs"`
	ToolName *string  `json:"toolName"`
}

func validateCell(cell cellContract, path string, schemaVersion int) error {
	validStatus := cell.Status != nil && (oneOf(*cell.Status, "passed", "failed", "errored", "skipped") || (schemaVersion == 4 && *cell.Status == "timed_out"))
	if cell.CaseID == nil || cell.Variant == nil || cell.Trial == nil || *cell.Trial < 0 || !validStatus {
		return contractError(path, "identity or status is malformed")
	}
	if err := validateTask(cell.Task, path+".task", schemaVersion); err != nil {
		return err
	}
	timedOut := *cell.Status == "timed_out"
	if timedOut != (cell.Task.Status != nil && *cell.Task.Status == "timed_out" && validCellTimeout(cell.Timeout)) || (timedOut && cell.Error != nil) || (!timedOut && cell.Timeout != nil) {
		return contractError(path+".timeout", "is inconsistent with cell status")
	}
	if schemaVersion == 4 {
		if cell.ScorerContracts == nil {
			return contractError(path+".scorerContracts", "is required")
		}
		for index, contract := range *cell.ScorerContracts {
			if contract.Name == nil || *contract.Name == "" || contract.ContractFingerprint == nil || *contract.ContractFingerprint == "" {
				return contractError(fmt.Sprintf("%s.scorerContracts[%d]", path, index), "is malformed")
			}
		}
	}
	if cell.Scores == nil {
		return contractError(path+".scores", "is required")
	}
	for index, score := range *cell.Scores {
		if err := validateScore(score, fmt.Sprintf("%s.scores[%d]", path, index)); err != nil {
			return err
		}
	}
	if err := validateAssertions(cell.Assertions, path+".assertions"); err != nil {
		return err
	}
	if len(cell.Input) == 0 || !rawObject(cell.Call) || !rawObject(cell.Response) {
		return contractError(path, "input/call/response is malformed")
	}
	if cell.UnvalidatedExpected != nil && !*cell.UnvalidatedExpected {
		return contractError(path+".unvalidatedExpected", "may only be true when present")
	}
	if cell.Error != nil && (cell.Error.Message == nil || cell.Error.Phase == nil || !oneOf(*cell.Error.Phase, "execute", "expect", "afterScores", "score")) {
		return contractError(path+".error", "is malformed")
	}
	if cell.Metrics == nil || cell.Metrics.DurationMS == nil || !validNonnegative(*cell.Metrics.DurationMS) || (cell.Metrics.CostUSD != nil && !validNonnegative(*cell.Metrics.CostUSD)) {
		return contractError(path+".metrics", "is malformed")
	}
	if cell.RunIDs == nil || cell.CapturedSignals == nil {
		return contractError(path+".runIds/capturedSignals", "are required")
	}
	return nil
}

func validateTask(task *taskContract, path string, schemaVersion int) error {
	if task == nil || task.Status == nil {
		return contractError(path, "is malformed")
	}
	switch *task.Status {
	case "executed":
		if task.Reason == nil || !oneOf(*task.Reason, "live_required", "fresh_requested", "performance_freshness", "no_exact_evidence", "identity_unavailable", "model_identity_unattested", "untracked_external_dependency", "nondeterministic_renderer", "task_binding_untracked", "unresolved_source_dependency", "implicit_media", "registry_identity_unavailable", "host_contract_unavailable") {
			return contractError(path, "has an invalid executed reason")
		}
	case "reused":
		if task.Reason == nil || *task.Reason != "exact_evidence" || task.EvidenceFingerprint == nil || task.EvidenceRef == nil || task.FreshnessSource != nil {
			return contractError(path, "reused task requires exact evidence")
		}
	case "errored":
		if task.Reason == nil || *task.Reason != "task_error" || task.EvidenceFingerprint != nil || task.EvidenceRef != nil || task.FreshnessSource != nil {
			return contractError(path, "errored task is malformed")
		}
	case "skipped":
		if task.Reason == nil || *task.Reason != "source_skipped" || task.EvidenceFingerprint != nil || task.EvidenceRef != nil || task.FreshnessSource != nil {
			return contractError(path, "skipped task is malformed")
		}
	case "timed_out":
		if schemaVersion != 4 || task.Reason != nil || task.EvidenceFingerprint != nil || task.EvidenceRef != nil || task.FreshnessSource != nil {
			return contractError(path, "timed-out task is malformed")
		}
	default:
		return contractError(path, "has an unknown status")
	}
	return nil
}

func validCellTimeout(value *cellTimeoutContract) bool {
	if value == nil || value.Budget == nil || !oneOf(*value.Budget, "total", "step", "chunk", "firstToken", "tool") || value.LimitMS == nil || !validNonnegative(*value.LimitMS) || *value.LimitMS == 0 {
		return false
	}
	return (*value.Budget == "tool") == (value.ToolName != nil && *value.ToolName != "")
}
