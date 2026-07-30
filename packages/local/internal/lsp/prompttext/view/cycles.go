package view

func noncyclicJoins(
	values []FragmentJoin,
	signatures map[FragmentJoinKey]string,
) []FragmentJoin {
	graph := make(map[SourceRefKey][]SourceRefKey)
	for _, value := range values {
		owner := SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.OwnerSourceRefID,
		}
		target := SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.TargetSourceRefID,
		}
		graph[owner] = append(graph[owner], target)
	}
	result := values[:0]
	for _, value := range values {
		owner := SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.OwnerSourceRefID,
		}
		target := SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.TargetSourceRefID,
		}
		if joinPathExists(graph, target, owner, make(map[SourceRefKey]struct{})) {
			delete(signatures, value.Key)
			continue
		}
		result = append(result, value)
	}
	return result
}

func joinPathExists(
	graph map[SourceRefKey][]SourceRefKey,
	current SourceRefKey,
	target SourceRefKey,
	visited map[SourceRefKey]struct{},
) bool {
	if current == target {
		return true
	}
	if _, seen := visited[current]; seen {
		return false
	}
	visited[current] = struct{}{}
	for _, next := range graph[current] {
		if joinPathExists(graph, next, target, visited) {
			return true
		}
	}
	return false
}
