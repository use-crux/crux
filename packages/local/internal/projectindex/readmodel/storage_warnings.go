package readmodel

import "github.com/use-crux/crux/packages/local/internal/store"

func storageWarnings(def store.ProjectDefinition, summary storageDefinitionSummary, relations storageRelationIndex, byID map[string]store.ProjectDefinition) []storageWarningSummary {
	var warnings []storageWarningSummary
	for _, use := range summary.UsedBy {
		if use.Kind == "workspace" && summary.Components.AssetStoreID == "" {
			warnings = append(warnings, storageWarningSummary{
				Code:                 "storage.workspace_asset_missing",
				Severity:             "warning",
				Message:              "Workspace is wired to storage without an asset store; large workspace payloads will fail or remain inline-only.",
				PrimaryDefinitionID:  use.DefinitionID,
				RelatedDefinitionIDs: []string{def.ID},
			})
		}
		if use.Kind == "rag.retriever" && searchFilterCapability(summary.Capabilities) == "post" {
			warnings = append(warnings, storageWarningSummary{
				Code:                 "storage.search_filter_not_prefiltered",
				Severity:             "warning",
				Message:              "Retriever is wired to a search store that filters after search; filtered retrieval needs pre-filtering for production correctness.",
				PrimaryDefinitionID:  def.ID,
				RelatedDefinitionIDs: []string{use.DefinitionID, summary.Components.SearchStoreID},
			})
		}
	}
	if def.Kind == "storage.searchStore" && searchFilterCapability(summary.Capabilities) == "post" {
		for _, relation := range relations.incoming[def.ID] {
			parent := byID[relation.From]
			if parent.Kind == "storage.bundle" || parent.Kind == "storage.scope" {
				continue
			}
			if parent.Kind == "rag.retriever" {
				warnings = append(warnings, storageWarningSummary{
					Code:                 "storage.search_filter_not_prefiltered",
					Severity:             "warning",
					Message:              "Retriever is wired to a search store that filters after search; filtered retrieval needs pre-filtering for production correctness.",
					PrimaryDefinitionID:  def.ID,
					RelatedDefinitionIDs: []string{parent.ID},
				})
			}
		}
	}
	return dedupeStorageWarnings(warnings)
}

func searchFilterCapability(capabilities map[string]any) string {
	search := rawMapAny(capabilities["search"])
	filter, _ := search["filter"].(string)
	return filter
}

func mergeStorageLintFindings(existing []store.IndexLintFinding, warnings []storageWarningSummary) []store.IndexLintFinding {
	if len(warnings) == 0 {
		return existing
	}
	next := append([]store.IndexLintFinding(nil), existing...)
	seen := map[string]bool{}
	for _, finding := range existing {
		seen[finding.ID] = true
	}
	for _, warning := range dedupeStorageWarnings(warnings) {
		id := "lint:" + warning.Code + ":" + warning.PrimaryDefinitionID
		if seen[id] {
			continue
		}
		seen[id] = true
		next = append(next, store.IndexLintFinding{
			ID:                   id,
			Severity:             warning.Severity,
			RuleID:               warning.Code,
			Category:             "runtime",
			Maturity:             "preview",
			Confidence:           "high",
			Profiles:             []string{"recommended"},
			Title:                storageWarningTitle(warning.Code),
			Message:              warning.Message,
			Rationale:            "Storage Beta capability claims must match the primitives wired to each adapter.",
			PrimaryDefinitionID:  warning.PrimaryDefinitionID,
			RelatedDefinitionIDs: warning.RelatedDefinitionIDs,
			Evidence:             []store.IndexLintEvidence{},
			Fixes:                []store.IndexLintFix{},
		})
	}
	return next
}

func storageWarningTitle(code string) string {
	switch code {
	case "storage.workspace_asset_missing":
		return "Workspace has no asset store"
	case "storage.search_filter_not_prefiltered":
		return "Search filters are not pre-filtered"
	default:
		return "Storage capability warning"
	}
}

func dedupeStorageWarnings(warnings []storageWarningSummary) []storageWarningSummary {
	seen := map[string]bool{}
	var out []storageWarningSummary
	for _, warning := range warnings {
		key := warning.Code + "\x00" + warning.PrimaryDefinitionID
		if seen[key] {
			continue
		}
		seen[key] = true
		warning.RelatedDefinitionIDs = uniqueStrings(warning.RelatedDefinitionIDs)
		out = append(out, warning)
	}
	return out
}

func uniqueStrings(values []string) []string {
	var out []string
	for _, value := range values {
		if value != "" {
			out = appendUniqueString(out, value)
		}
	}
	return out
}
