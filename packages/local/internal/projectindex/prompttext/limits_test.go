package prompttext

import "testing"

func TestAttachedRequestBoundIncludesTheAggregateFragmentBudget(t *testing.T) {
	t.Parallel()

	const want = 13_041_664
	if MaxRequestBytes != want {
		t.Fatalf("MaxRequestBytes = %d, want %d", MaxRequestBytes, want)
	}
}
