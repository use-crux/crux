package screens

import (
	"encoding/json"
	"sort"
)

type evalCatalogItem struct {
	ID                    string
	DefinitionFingerprint string
	CaseIDs               []string
	VariantIDs            []string
	SourceFile            string
	HostStatus            string
	HostRemedy            string
}

type evalRunItem struct {
	RunID                 string
	EvalID                string
	DefinitionFingerprint string
	Status                string
	Passed                bool
	StartedAt             int64
	Cases                 []string
	Variants              []string
	Cells                 []evalCell
	Aggregates            map[string]evalAggregate
	Gates                 []evalGate
}

type evalAggregate struct {
	Cells   int `json:"cells"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Skipped int `json:"skipped"`
}

type evalCell struct {
	CaseID   string          `json:"caseId"`
	CaseName string          `json:"caseName"`
	Variant  string          `json:"variant"`
	Trial    int             `json:"trial"`
	Status   string          `json:"status"`
	Task     evalCellTask    `json:"task"`
	Scores   []evalCellScore `json:"scores"`
	Metrics  evalCellMetrics `json:"metrics"`
	RunIDs   []string        `json:"runIds"`
	Input    any             `json:"input"`
	Expected any             `json:"expected"`
	Output   any             `json:"output"`
}

type evalCellTask struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type evalCellScore struct {
	Name   string   `json:"name"`
	Status string   `json:"status"`
	Value  *float64 `json:"value"`
}

type evalCellMetrics struct {
	DurationMs *float64 `json:"durationMs"`
	CostUSD    *float64 `json:"costUsd"`
}

type evalGate struct {
	Name        string   `json:"gate"`
	VariantName string   `json:"variantName"`
	Threshold   *float64 `json:"threshold"`
	Actual      *float64 `json:"actual"`
	Passed      *bool    `json:"passed"`
}

type evalBaselineItem struct {
	BaselineID    string            `json:"baselineId"`
	EvalID        string            `json:"evalId"`
	RunID         string            `json:"runId"`
	SelectedArm   string            `json:"selectedArm"`
	PromotedAt    int64             `json:"promotedAt"`
	PromotedBy    string            `json:"promotedBy"`
	Compatibility evalCompatibility `json:"baselineCompatibility"`
}

type evalCompatibility struct {
	Status string                  `json:"status"`
	Reason string                  `json:"reason"`
	Cases  []evalCaseCompatibility `json:"cases"`
}

type evalCaseCompatibility struct {
	CaseID string `json:"caseId"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}

func projectEvalCatalog(raw []json.RawMessage) []evalCatalogItem {
	items := make([]evalCatalogItem, 0, len(raw))
	for _, record := range raw {
		var source struct {
			ID                    string `json:"id"`
			DefinitionFingerprint string `json:"definitionFingerprint"`
			Cases                 []struct {
				ID string `json:"id"`
			} `json:"cases"`
			Variants  []json.RawMessage `json:"variants"`
			SourceKey struct {
				RelativeFile string `json:"relativeFile"`
			} `json:"sourceKey"`
			HostReadiness struct {
				Status   string   `json:"status"`
				Reason   string   `json:"reason"`
				Remedy   string   `json:"remedy"`
				Remedies []string `json:"remedies"`
			} `json:"hostReadiness"`
		}
		if json.Unmarshal(record, &source) != nil || source.ID == "" {
			continue
		}
		item := evalCatalogItem{
			ID:                    source.ID,
			DefinitionFingerprint: source.DefinitionFingerprint,
			SourceFile:            source.SourceKey.RelativeFile,
			HostStatus:            source.HostReadiness.Status,
		}
		for _, evalCase := range source.Cases {
			if evalCase.ID != "" {
				item.CaseIDs = append(item.CaseIDs, evalCase.ID)
			}
		}
		for _, variant := range source.Variants {
			var name string
			if json.Unmarshal(variant, &name) != nil {
				var object struct {
					Name string `json:"name"`
				}
				if json.Unmarshal(variant, &object) == nil {
					name = object.Name
				}
			}
			if name != "" {
				item.VariantIDs = append(item.VariantIDs, name)
			}
		}
		if len(source.HostReadiness.Remedies) > 0 {
			item.HostRemedy = source.HostReadiness.Remedies[0]
		} else {
			item.HostRemedy = source.HostReadiness.Remedy
		}
		if item.HostRemedy == "" {
			item.HostRemedy = source.HostReadiness.Reason
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func projectEvalRuns(raw []json.RawMessage) []evalRunItem {
	items := make([]evalRunItem, 0, len(raw))
	for _, record := range raw {
		if item, ok := projectEvalRun(record); ok {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].StartedAt == items[j].StartedAt {
			return items[i].RunID > items[j].RunID
		}
		return items[i].StartedAt > items[j].StartedAt
	})
	return items
}

func projectEvalRun(raw json.RawMessage) (evalRunItem, bool) {
	var source struct {
		RunID                 string `json:"runId"`
		EvalID                string `json:"evalId"`
		DefinitionFingerprint string `json:"definitionFingerprint"`
		Status                string `json:"status"`
		Passed                bool   `json:"passed"`
		StartedAt             int64  `json:"startedAt"`
		Selection             struct {
			Cases    []string `json:"cases"`
			Variants []string `json:"variants"`
		} `json:"selection"`
		Variants []struct {
			Name string `json:"name"`
		} `json:"variants"`
		Cells      []evalCell               `json:"cells"`
		Aggregates map[string]evalAggregate `json:"aggregates"`
		Gates      struct {
			Results []evalGate `json:"results"`
		} `json:"gates"`
	}
	if json.Unmarshal(raw, &source) != nil || source.RunID == "" || source.EvalID == "" {
		return evalRunItem{}, false
	}
	item := evalRunItem{
		RunID: source.RunID, EvalID: source.EvalID, DefinitionFingerprint: source.DefinitionFingerprint,
		Status: source.Status, Passed: source.Passed,
		StartedAt: source.StartedAt, Cases: source.Selection.Cases,
		Variants: source.Selection.Variants, Cells: source.Cells, Aggregates: source.Aggregates,
		Gates: source.Gates.Results,
	}
	if len(item.Cases) == 0 {
		for _, cell := range item.Cells {
			item.Cases = appendUniqueEvalString(item.Cases, cell.CaseID)
		}
	}
	if len(item.Variants) == 0 {
		for _, variant := range source.Variants {
			item.Variants = appendUniqueEvalString(item.Variants, variant.Name)
		}
	}
	return item, true
}

func appendUniqueEvalString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func projectEvalBaselines(raw []json.RawMessage) []evalBaselineItem {
	items := make([]evalBaselineItem, 0, len(raw))
	for _, record := range raw {
		var item evalBaselineItem
		if json.Unmarshal(record, &item) == nil && item.EvalID != "" {
			items = append(items, item)
		}
	}
	return items
}
