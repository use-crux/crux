package view

import "testing"

func TestNoncyclicJoinsDropsEveryEdgeInACycle(t *testing.T) {
	joins := []FragmentJoin{
		testJoin("a", "b", 0),
		testJoin("b", "a", 1),
		testJoin("c", "d", 2),
	}
	signatures := map[FragmentJoinKey]string{}
	for _, join := range joins {
		signatures[join.Key] = "signature"
	}
	got := noncyclicJoins(joins, signatures)
	if len(got) != 1 || got[0].Key.OwnerSourceRefID != "c" ||
		len(signatures) != 1 {
		t.Fatalf("noncyclic joins = %#v, signatures=%#v", got, signatures)
	}
}

func testJoin(
	owner string,
	target string,
	index uint32,
) FragmentJoin {
	return FragmentJoin{Key: FragmentJoinKey{
		DefinitionID: "prompt:owner", OwnerSourceRefID: owner,
		InterpolationIndex: index, TargetSourceRefID: target,
	}}
}
