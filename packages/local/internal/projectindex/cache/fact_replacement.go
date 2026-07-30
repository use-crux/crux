package cache

import (
	"context"
	"database/sql"
	"fmt"
)

// deleteReplacedFactGroups removes prior phase rows for explicitly empty
// array groups. Non-empty groups continue through the existing per-file
// invalidation and fact-ID replacement path; omitted groups remain untouched.
func deleteReplacedFactGroups(
	ctx context.Context,
	tx *sql.Tx,
	root string,
	phase IndexPatchPhase,
	facts IndexPatchFacts,
) error {
	for _, kind := range explicitlyEmptyFactKinds(facts) {
		rows, err := tx.QueryContext(ctx, `
			SELECT fact_id
			FROM index_facts
			WHERE root = ? AND phase = ? AND kind = ?
		`, root, string(phase), kind)
		if err != nil {
			return fmt.Errorf("query replaced project index fact group %s: %w", kind, err)
		}
		var factIDs []string
		for rows.Next() {
			var factID string
			if err := rows.Scan(&factID); err != nil {
				rows.Close()
				return fmt.Errorf("scan replaced project index fact group %s: %w", kind, err)
			}
			factIDs = append(factIDs, factID)
		}
		if err := rows.Close(); err != nil {
			return fmt.Errorf("close replaced project index fact group %s: %w", kind, err)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate replaced project index fact group %s: %w", kind, err)
		}
		for _, factID := range factIDs {
			if err := deleteFactKey(
				ctx,
				tx,
				root,
				factKey{Phase: string(phase), FactID: factID},
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func explicitlyEmptyFactKinds(facts IndexPatchFacts) []string {
	kinds := make([]string, 0, 10)
	if facts.Prompts != nil && len(facts.Prompts) == 0 {
		kinds = append(kinds, "prompts")
	}
	if facts.Contexts != nil && len(facts.Contexts) == 0 {
		kinds = append(kinds, "contexts")
	}
	if facts.Tools != nil && len(facts.Tools) == 0 {
		kinds = append(kinds, "tools")
	}
	if facts.Definitions != nil && len(facts.Definitions) == 0 {
		kinds = append(kinds, "definitions")
	}
	if facts.Relations != nil && len(facts.Relations) == 0 {
		kinds = append(kinds, "relations")
	}
	if facts.SourceRefs != nil && len(facts.SourceRefs) == 0 {
		kinds = append(kinds, "sourceRefs")
	}
	if facts.Diagnostics != nil && len(facts.Diagnostics) == 0 {
		kinds = append(kinds, "diagnostics")
	}
	if facts.LintFindings != nil && len(facts.LintFindings) == 0 {
		kinds = append(kinds, "lintFindings")
	}
	if facts.RuleDescriptors != nil && len(facts.RuleDescriptors) == 0 {
		kinds = append(kinds, "ruleDescriptors")
	}
	if facts.Sources != nil && len(facts.Sources) == 0 {
		kinds = append(kinds, "sources")
	}
	return kinds
}
