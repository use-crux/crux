package screens

func (run evalRunItem) cell(row, column int) evalCell {
	if row < 0 || row >= len(run.Cases) || column < 0 || column >= len(run.Variants) {
		return evalCell{}
	}
	caseID, variant := run.Cases[row], run.Variants[column]
	if representative, found := run.representativeCell(caseID, variant); found {
		return representative
	}
	return evalCell{CaseID: caseID, CaseName: caseID, Variant: variant, Status: "not-run"}
}

func (run evalRunItem) representativeCell(caseID, variant string) (evalCell, bool) {
	var representative evalCell
	found := false
	for _, cell := range run.Cells {
		if cell.CaseID != caseID || cell.Variant != variant {
			continue
		}
		if !found || evalCellPrecedes(cell, representative) {
			representative = cell
			found = true
		}
	}
	return representative, found
}

// evalCellPrecedes chooses the representative trial shown by the compact grid.
// Failures win over passes, which win over skipped/not-run cells. Equal-status
// trials use the lowest trial number so refreshes remain deterministic.
func evalCellPrecedes(candidate, current evalCell) bool {
	candidateRank := evalCellStatusRank(candidate.Status)
	currentRank := evalCellStatusRank(current.Status)
	if candidateRank != currentRank {
		return candidateRank > currentRank
	}
	return candidate.Trial < current.Trial
}

func evalCellStatusRank(status string) int {
	switch normalizeEvalCellStatus(status) {
	case "fail":
		return 3
	case "pass":
		return 2
	case "skipped":
		return 1
	default:
		return 0
	}
}

func (run evalRunItem) trialCount(caseID, variant string) int {
	count := 0
	for _, cell := range run.Cells {
		if cell.CaseID == caseID && cell.Variant == variant {
			count++
		}
	}
	return count
}

func (run evalRunItem) passFailCounts() (int, int) {
	passed, failed := 0, 0
	for _, cell := range run.Cells {
		switch normalizeEvalCellStatus(cell.Status) {
		case "pass":
			passed++
		case "fail":
			failed++
		}
	}
	return passed, failed
}

func normalizeEvalCellStatus(status string) string {
	switch status {
	case "passed", "pass", "ok", "success":
		return "pass"
	case "failed", "fail", "error", "errored", "timed-out", "timed_out":
		return "fail"
	case "skipped":
		return "skipped"
	default:
		return "not-run"
	}
}
