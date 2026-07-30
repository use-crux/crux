package prompttext

// noncyclicSemanticJoins validates the compiler-owned graph before selecting
// document-reachable evidence. An edge participating in a cycle is omitted;
// Go does not reinterpret or break semantic cycles.
func noncyclicSemanticJoins(
	refs map[string]semanticRef,
) map[string][]semanticFragmentJoin {
	graph := make(map[string][]semanticFragmentJoin, len(refs))
	for ownerID, owner := range refs {
		for _, join := range uniqueSemanticJoins(owner.joins) {
			target, ok := refs[join.TargetSourceRefID]
			if ok && validSemanticJoin(owner, target, join) {
				graph[ownerID] = append(graph[ownerID], join)
			}
		}
	}

	result := make(map[string][]semanticFragmentJoin, len(graph))
	for ownerID, joins := range graph {
		for _, join := range joins {
			if semanticPathExists(
				graph, join.TargetSourceRefID, ownerID, make(map[string]struct{}),
			) {
				continue
			}
			result[ownerID] = append(result[ownerID], join)
		}
	}
	return result
}

func semanticPathExists(
	graph map[string][]semanticFragmentJoin,
	current string,
	target string,
	visited map[string]struct{},
) bool {
	if current == target {
		return true
	}
	if _, seen := visited[current]; seen {
		return false
	}
	visited[current] = struct{}{}
	for _, join := range graph[current] {
		if semanticPathExists(graph, join.TargetSourceRefID, target, visited) {
			return true
		}
	}
	return false
}
