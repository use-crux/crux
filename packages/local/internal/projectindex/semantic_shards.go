package projectindex

import (
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectSemanticShardRequest is one shard-local semantic enrichment request.
type ProjectSemanticShardRequest struct {
	ShardID string
	Request ProjectSemanticIndexRequest
}

// ProjectSemanticShardRequests splits a semantic request into shard-local type
// work when the source graph proves both shard ownership and dependencies.
//
// The function returns nil when sharding would be speculative. Callers should
// then run the original request unchanged.
func ProjectSemanticShardRequests(request ProjectSemanticIndexRequest) []ProjectSemanticShardRequest {
	index := request.PreviousIndex
	if index == nil || index.SourceGraph == nil || len(request.Files) < 2 {
		return nil
	}
	graph := index.SourceGraph
	if !slices.Contains(graph.Capabilities, "project-shards") ||
		!slices.Contains(graph.Capabilities, "source-dependencies") ||
		len(graph.Shards) < 2 ||
		!HasCompleteShardEvidence(*index) {
		return nil
	}

	sourcesByFile := indexSourcesByFile(index.Sources)
	filesByShardID := map[string][]string{}
	for _, file := range sortedUniqueStrings(request.Files) {
		shardID := semanticShardIDForFile(file, sourcesByFile, graph.Shards)
		if shardID == "" {
			return nil
		}
		filesByShardID[shardID] = append(filesByShardID[shardID], file)
	}
	if len(filesByShardID) < 2 {
		return nil
	}

	shardIDs := sortedMapKeys(filesByShardID)
	shards := make([]ProjectSemanticShardRequest, 0, len(shardIDs))
	for _, shardID := range shardIDs {
		files := sortedUniqueStrings(filesByShardID[shardID])
		closure := semanticShardDependencyClosure(*index, files)
		closure = restrictSemanticClosure(closure, request.DependencyClosure, files)
		previous := compactSemanticShardPreviousIndex(*index, closure)

		shardRequest := request
		shardRequest.Files = files
		shardRequest.DependencyClosure = closure
		shardRequest.PreviousIndex = &previous
		shardRequest.SourceProfile = semanticShardSourceProfile(request.SourceProfile, closure)
		shards = append(shards, ProjectSemanticShardRequest{ShardID: shardID, Request: shardRequest})
	}
	return shards
}

// MergeSemanticPatches combines shard-local semantic patches into one semantic
// patch without adding snapshot invalidation. The service applies the merged
// patch on top of the current AST/source state.
func MergeSemanticPatches(patches []IndexPatch) (IndexPatch, error) {
	if len(patches) == 0 {
		return IndexPatch{}, fmt.Errorf("merge semantic patches: no patches")
	}

	merged := IndexPatch{
		SchemaVersion: patches[0].SchemaVersion,
		Phase:         PhaseSemantic,
		Project:       patches[0].Project,
		StartedAt:     patches[0].StartedAt,
		Status:        "ok",
	}
	definitionsByID := map[string]int{}
	relationsByID := map[string]int{}
	sourceRefsByID := map[string]int{}
	diagnosticsByID := map[string]int{}
	lintFindingsByID := map[string]int{}
	ruleDescriptorsByID := map[string]int{}
	sourcesByFile := map[string]int{}

	for _, patch := range patches {
		if merged.SchemaVersion == 0 {
			merged.SchemaVersion = patch.SchemaVersion
		}
		if merged.Project.Root == "" {
			merged.Project = patch.Project
		}
		if merged.StartedAt == "" {
			merged.StartedAt = patch.StartedAt
		}
		if patch.FinishedAt != "" {
			merged.FinishedAt = patch.FinishedAt
		}
		merged.Status = mergeSemanticPatchStatus(merged.Status, patch.Status)
		if merged.Facts.SourceGraph == nil && patch.Facts.SourceGraph != nil {
			merged.Facts.SourceGraph = patch.Facts.SourceGraph
		}
		merged.Facts.Definitions = appendMergedDefinitions(merged.Facts.Definitions, definitionsByID, patch.Facts.Definitions)
		merged.Facts.Relations = appendMergedRelations(merged.Facts.Relations, relationsByID, patch.Facts.Relations)
		merged.Facts.SourceRefs = appendMergedSourceRefs(merged.Facts.SourceRefs, sourceRefsByID, patch.Facts.SourceRefs)
		merged.Facts.Diagnostics = appendMergedDiagnostics(merged.Facts.Diagnostics, diagnosticsByID, patch.Facts.Diagnostics)
		merged.Facts.LintFindings = appendMergedLintFindings(merged.Facts.LintFindings, lintFindingsByID, patch.Facts.LintFindings)
		merged.Facts.RuleDescriptors = appendMergedRuleDescriptors(
			merged.Facts.RuleDescriptors,
			ruleDescriptorsByID,
			patch.Facts.RuleDescriptors,
		)
		merged.Facts.Sources = appendMergedSources(merged.Facts.Sources, sourcesByFile, patch.Facts.Sources)
		merged.FactEnvelopes = append(merged.FactEnvelopes, patch.FactEnvelopes...)
	}
	return merged, nil
}

func indexSourcesByFile(sources []store.IndexSourceFile) map[string]store.IndexSourceFile {
	byFile := map[string]store.IndexSourceFile{}
	for _, source := range sources {
		if source.File != "" {
			byFile[source.File] = source
		}
	}
	return byFile
}

func semanticShardIDForFile(
	file string,
	sourcesByFile map[string]store.IndexSourceFile,
	shards []store.ProjectIndexShard,
) string {
	if source, ok := sourcesByFile[file]; ok && source.ShardID != "" {
		return source.ShardID
	}
	bestID := ""
	bestRootLen := -1
	for _, shard := range shards {
		if shard.Root == "" {
			continue
		}
		if file == shard.Root || strings.HasPrefix(file, shard.Root+"/") {
			if len(shard.Root) > bestRootLen {
				bestID = shard.ID
				bestRootLen = len(shard.Root)
			}
		}
	}
	return bestID
}

func semanticShardDependencyClosure(index store.IndexData, files []string) []string {
	dependenciesByFile := map[string][]string{}
	sourceFiles := map[string]bool{}
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		sourceFiles[source.File] = true
		dependenciesByFile[source.File] = append([]string(nil), source.Dependencies...)
	}
	seen := map[string]bool{}
	queue := append([]string(nil), files...)
	for len(queue) > 0 {
		file := queue[0]
		queue = queue[1:]
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		for _, dependency := range dependenciesByFile[file] {
			if dependency == "" || seen[dependency] || !sourceFiles[dependency] {
				continue
			}
			queue = append(queue, dependency)
		}
		sort.Strings(queue)
	}
	return sortedMapKeys(seen)
}

func restrictSemanticClosure(closure []string, requestClosure []string, files []string) []string {
	if len(requestClosure) == 0 {
		return sortedUniqueStrings(append(closure, files...))
	}
	allowed := map[string]bool{}
	for _, file := range requestClosure {
		if file != "" {
			allowed[file] = true
		}
	}
	for _, file := range files {
		if file != "" {
			allowed[file] = true
		}
	}
	filtered := make([]string, 0, len(closure)+len(files))
	for _, file := range append(closure, files...) {
		if file != "" && allowed[file] {
			filtered = append(filtered, file)
		}
	}
	return sortedUniqueStrings(filtered)
}

func compactSemanticShardPreviousIndex(index store.IndexData, scopeFiles []string) store.IndexData {
	previous := store.IndexData{
		SchemaVersion: index.SchemaVersion,
		Project:       index.Project,
		IndexedAt:     index.IndexedAt,
		Indexing:      index.Indexing,
		Lint:          index.Lint,
		SourceGraph:   index.SourceGraph,
	}
	scope := map[string]bool{}
	for _, file := range scopeFiles {
		if file != "" {
			scope[file] = true
		}
	}
	for _, definition := range index.Definitions {
		if definition.Source == nil || definition.Source.File == "" || scope[definition.Source.File] {
			previous.Definitions = append(previous.Definitions, definition)
		}
	}
	for _, source := range index.Sources {
		if source.File == "" || scope[source.File] {
			previous.Sources = append(previous.Sources, source)
		}
	}
	return previous
}

func semanticShardSourceProfile(profile *SemanticSourceProfile, closure []string) *SemanticSourceProfile {
	if profile == nil {
		return nil
	}
	closureSet := map[string]bool{}
	for _, file := range closure {
		if file != "" {
			closureSet[file] = true
		}
	}
	next := *profile
	next.DependencyClosure = sortedUniqueStrings(closure)
	next.Files = make([]SemanticSourceProfileFile, 0, len(profile.Files))
	sourceBytes := 0
	present := map[string]bool{}
	for _, file := range profile.Files {
		if len(closureSet) > 0 && !closureSet[file.File] {
			continue
		}
		next.Files = append(next.Files, file)
		present[file.File] = true
		sourceBytes += file.SourceBytes
	}
	next.SourceBytes = sourceBytes
	next.Complete = profile.Complete && len(next.DependencyClosure) > 0
	for _, file := range next.DependencyClosure {
		if !present[file] {
			next.Complete = false
			break
		}
	}
	return &next
}

func appendMergedDefinitions(
	current []store.ProjectDefinition,
	index map[string]int,
	incoming []store.ProjectDefinition,
) []store.ProjectDefinition {
	for _, definition := range incoming {
		if existingIndex, ok := index[definition.ID]; ok {
			current[existingIndex] = MergeProjectDefinition(current[existingIndex], definition)
			continue
		}
		index[definition.ID] = len(current)
		current = append(current, definition)
	}
	return current
}

func appendMergedRelations(
	current []store.ProjectRelation,
	index map[string]int,
	incoming []store.ProjectRelation,
) []store.ProjectRelation {
	for _, relation := range incoming {
		key := RelationMergeKey(relation)
		if existingIndex, ok := index[key]; ok {
			current[existingIndex] = relation
			continue
		}
		index[key] = len(current)
		current = append(current, relation)
	}
	return current
}

func appendMergedSourceRefs(
	current []IndexSourceRefFact,
	index map[string]int,
	incoming []IndexSourceRefFact,
) []IndexSourceRefFact {
	for _, sourceRef := range incoming {
		key := sourceRef.DefinitionID + "\x00" + sourceRef.Ref.ID
		if existingIndex, ok := index[key]; ok {
			current[existingIndex] = sourceRef
			continue
		}
		index[key] = len(current)
		current = append(current, sourceRef)
	}
	return current
}

func appendMergedDiagnostics(
	current []store.IndexDiagnostic,
	index map[string]int,
	incoming []store.IndexDiagnostic,
) []store.IndexDiagnostic {
	for _, diagnostic := range incoming {
		if existingIndex, ok := index[diagnostic.ID]; ok {
			current[existingIndex] = diagnostic
			continue
		}
		index[diagnostic.ID] = len(current)
		current = append(current, diagnostic)
	}
	return current
}

func appendMergedLintFindings(
	current []store.IndexLintFinding,
	index map[string]int,
	incoming []store.IndexLintFinding,
) []store.IndexLintFinding {
	for _, finding := range incoming {
		if existingIndex, ok := index[finding.ID]; ok {
			current[existingIndex] = finding
			continue
		}
		index[finding.ID] = len(current)
		current = append(current, finding)
	}
	return current
}

func appendMergedRuleDescriptors(
	current []store.IndexRuleDescriptor,
	index map[string]int,
	incoming []store.IndexRuleDescriptor,
) []store.IndexRuleDescriptor {
	for _, descriptor := range incoming {
		if existingIndex, ok := index[descriptor.ID]; ok {
			current[existingIndex] = descriptor
			continue
		}
		index[descriptor.ID] = len(current)
		current = append(current, descriptor)
	}
	return current
}

func appendMergedSources(
	current []store.IndexSourceFile,
	index map[string]int,
	incoming []store.IndexSourceFile,
) []store.IndexSourceFile {
	for _, source := range incoming {
		if existingIndex, ok := index[source.File]; ok {
			current[existingIndex] = mergeSemanticSourceFile(current[existingIndex], source)
			continue
		}
		index[source.File] = len(current)
		current = append(current, source)
	}
	return current
}

func mergeSemanticSourceFile(existing store.IndexSourceFile, incoming store.IndexSourceFile) store.IndexSourceFile {
	if incoming.Status != "" {
		existing.Status = incoming.Status
	}
	if incoming.ShardID != "" {
		existing.ShardID = incoming.ShardID
	}
	if incoming.SourceHash != "" {
		existing.SourceHash = incoming.SourceHash
	}
	if incoming.InterfaceHash != "" {
		existing.InterfaceHash = incoming.InterfaceHash
	}
	existing.DefinitionIDs = sortedUniqueStrings(append(existing.DefinitionIDs, incoming.DefinitionIDs...))
	if incoming.Dependencies != nil {
		existing.Dependencies = sortedUniqueStrings(incoming.Dependencies)
	}
	existing.Dependents = sortedUniqueStrings(append(existing.Dependents, incoming.Dependents...))
	existing.Diagnostics = sortedUniqueStrings(append(existing.Diagnostics, incoming.Diagnostics...))
	return existing
}

func mergeSemanticPatchStatus(current string, incoming string) string {
	if incoming == "degraded" || current == "degraded" {
		return "degraded"
	}
	if incoming == "partial" || current == "partial" {
		return "partial"
	}
	if current == "" {
		return incoming
	}
	return current
}

func sortedUniqueStrings(values []string) []string {
	seen := map[string]bool{}
	for _, value := range values {
		if value != "" {
			seen[value] = true
		}
	}
	return sortedMapKeys(seen)
}

func sortedMapKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
