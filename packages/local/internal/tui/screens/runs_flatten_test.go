package screens

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestFlattenRunPreservesStableRowIdentityDepthAndExpansion(t *testing.T) {
	spans := []api.InspectRunSpan{
		{ID: "root", Name: "agent", Primitive: api.SpanPrimitiveAgent},
		{ID: "child", ParentID: "root", Name: "tool", Primitive: api.SpanPrimitiveTool},
		{ID: "dup-1", ParentID: "child", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "dup-2", ParentID: "child", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
	}

	collapsed := FlattenRun(spans, nil)
	if got, want := runRowIDs(collapsed), []string{"root", "child", "dup-1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("collapsed row IDs = %v, want %v", got, want)
	}
	if got, want := []int{collapsed[0].Depth, collapsed[1].Depth, collapsed[2].Depth}, []int{0, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("collapsed depths = %v, want %v", got, want)
	}
	group := collapsed[2]
	if !group.Expandable || group.Expanded || group.ExpansionID != "retry-group" {
		t.Fatalf("collapsed expansion metadata = %#v, want expandable retry-group", group)
	}
	if got, want := group.Span.Name, "+ 2 more retry"; got != want {
		t.Fatalf("collapsed group name = %q, want %q", got, want)
	}

	expanded := FlattenRun(spans, map[string]bool{"retry-group": true})
	if got, want := runRowIDs(expanded), []string{"root", "child", "dup-1", "dup-2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("expanded row IDs = %v, want %v", got, want)
	}
	for _, row := range expanded[2:] {
		if !row.Expandable || !row.Expanded || row.ExpansionID != "retry-group" || row.Depth != 2 {
			t.Fatalf("expanded row metadata = %#v, want expanded retry-group at depth 2", row)
		}
	}
}

func TestFlattenRunPreservesExpansionWhenDuplicateRepresentativeChanges(t *testing.T) {
	expanded := map[string]bool{"retry-group": true}
	before := FlattenRun([]api.InspectRunSpan{
		{ID: "dup-1", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "dup-2", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
	}, expanded)
	after := FlattenRun([]api.InspectRunSpan{
		{ID: "dup-0", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "dup-1", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "dup-2", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
	}, expanded)

	if got, want := runRowIDs(before), []string{"dup-1", "dup-2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("rows before representative change = %v, want %v", got, want)
	}
	if got, want := runRowIDs(after), []string{"dup-0", "dup-1", "dup-2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("rows after representative change = %v, want %v", got, want)
	}
	for _, row := range append(before, after...) {
		if row.ExpansionID != "retry-group" || !row.Expanded {
			t.Fatalf("expanded row metadata = %#v, want stable retry-group identity", row)
		}
	}
}

func TestFlattenRunHidesDescendantsOfCollapsedDuplicateRows(t *testing.T) {
	spans := []api.InspectRunSpan{
		{ID: "root", Name: "root"},
		{ID: "dup-1", ParentID: "root", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "child-1", ParentID: "dup-1", Name: "first nested tool"},
		{ID: "dup-2", ParentID: "root", Name: "retry", Duplicate: true, DuplicateOfSpanID: "retry-group"},
		{ID: "child-2", ParentID: "dup-2", Name: "second nested tool"},
		{ID: "tail", ParentID: "root", Name: "tail"},
	}

	collapsed := FlattenRun(spans, nil)
	if got, want := runRowIDs(collapsed), []string{"root", "dup-1", "tail"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("collapsed hierarchy row IDs = %v, want %v", got, want)
	}
	expanded := FlattenRun(spans, map[string]bool{"retry-group": true})
	if got, want := runRowIDs(expanded), []string{"root", "dup-1", "child-1", "dup-2", "child-2", "tail"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("expanded hierarchy row IDs = %v, want %v", got, want)
	}
}

func runRowIDs(rows []RunRow) []string {
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.ID
	}
	return ids
}
