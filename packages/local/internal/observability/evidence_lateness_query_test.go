package observability

import (
	"strings"
	"testing"
)

func TestEvidenceSpanTerminalLookupUsesOwningRunIndex(t *testing.T) {
	service := newTestService(t)
	rows, err := service.db.Query(
		"EXPLAIN QUERY PLAN "+evidenceSpanTerminalQuery,
		"2222222222222222",
		"2222222222222222",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(detail)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "idx_records_run_id") {
		t.Fatalf("span terminal lookup does not use run index:\n%s", plan.String())
	}
}
