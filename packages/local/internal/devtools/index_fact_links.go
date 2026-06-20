package devtools

import (
	"context"
	"database/sql"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type indexFactLinks struct {
	SourceFiles   []string
	DefinitionIDs []string
	RelationIDs   []string
}

type factKey struct {
	Phase  string
	FactID string
}

func indexFactLinksForEnvelope(envelope IndexFactEnvelope) (indexFactLinks, error) {
	links := indexFactLinks{}
	switch envelope.Kind {
	case "prompts":
		var fact store.PromptMeta
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.DefinitionSource)
		links.addDefinition(fact.ID)
	case "contexts":
		var fact store.ContextMeta
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.DefinitionSource)
		links.addDefinition(fact.ID)
	case "definitions":
		var fact store.ProjectDefinition
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.Source)
		links.addDefinition(fact.ID)
	case "relations":
		var fact store.ProjectRelation
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.Source)
		links.addDefinition(fact.From)
		links.addDefinition(fact.To)
		links.addRelation(fact.ID)
	case "sourceRefs":
		var fact IndexSourceRefFact
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addDefinition(fact.DefinitionID)
		links.addSource(&fact.Ref.Source)
	case "diagnostics":
		var fact store.IndexDiagnostic
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.Source)
		for _, id := range fact.RelatedDefinitionIDs {
			links.addDefinition(id)
		}
	case "lintFindings":
		var fact store.IndexLintFinding
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSource(fact.Source)
		links.addDefinition(fact.PrimaryDefinitionID)
		for _, id := range fact.RelatedDefinitionIDs {
			links.addDefinition(id)
		}
		for _, id := range fact.AffectedDefinitionIDs {
			links.addDefinition(id)
		}
		for _, id := range fact.PropagatedDefinitionIDs {
			links.addDefinition(id)
		}
		for _, evidence := range fact.Evidence {
			links.addSource(evidence.Source)
			links.addDefinition(evidence.DefinitionID)
			links.addRelation(evidence.RelationID)
		}
		for _, path := range fact.PropagationPaths {
			links.addDefinition(path.FromDefinitionID)
			links.addDefinition(path.ToDefinitionID)
		}
	case "sources":
		var fact store.IndexSourceFile
		if err := decodeIndexFact(envelope, &fact); err != nil {
			return indexFactLinks{}, err
		}
		links.addSourceFile(fact.File)
		for _, id := range fact.DefinitionIDs {
			links.addDefinition(id)
		}
	}
	return links, nil
}

func (l *indexFactLinks) addSource(source *store.SourceLoc) {
	if source != nil {
		l.addSourceFile(source.File)
	}
}

func (l *indexFactLinks) addSourceFile(file string) {
	l.SourceFiles = appendUniqueNonEmpty(l.SourceFiles, file)
}

func (l *indexFactLinks) addDefinition(id string) {
	l.DefinitionIDs = appendUniqueNonEmpty(l.DefinitionIDs, id)
}

func (l *indexFactLinks) addRelation(id string) {
	l.RelationIDs = appendUniqueNonEmpty(l.RelationIDs, id)
}

func appendUniqueNonEmpty(values []string, value string) []string {
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

func factKeysAndDefinitionsForSources(ctx context.Context, tx *sql.Tx, root string, files []string) (map[factKey]bool, map[string]bool, error) {
	keys := map[factKey]bool{}
	definitionIDs := map[string]bool{}
	if len(files) == 0 {
		return keys, definitionIDs, nil
	}
	args := []any{root}
	for _, file := range files {
		args = append(args, file)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT links.phase, links.fact_id, facts.kind
		FROM index_fact_source_files AS links
		JOIN index_facts AS facts
			ON facts.root = links.root AND facts.phase = links.phase AND facts.fact_id = links.fact_id
		WHERE links.root = ? AND links.source_file IN (`+placeholders(len(files))+`)`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var definitionSeedKeys []factKey
	for rows.Next() {
		var key factKey
		var kind string
		if err := rows.Scan(&key.Phase, &key.FactID, &kind); err != nil {
			return nil, nil, err
		}
		keys[key] = true
		if factKindSeedsInvalidatedDefinitions(kind) {
			definitionSeedKeys = append(definitionSeedKeys, key)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	for _, key := range definitionSeedKeys {
		ids, err := definitionIDsForFactKey(ctx, tx, root, key)
		if err != nil {
			return nil, nil, err
		}
		for _, id := range ids {
			definitionIDs[id] = true
		}
	}
	return keys, definitionIDs, nil
}

func factKindSeedsInvalidatedDefinitions(kind string) bool {
	switch kind {
	case "prompts", "contexts", "definitions", "sources":
		return true
	default:
		return false
	}
}

func definitionIDsForFactKey(ctx context.Context, tx *sql.Tx, root string, key factKey) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT definition_id FROM index_fact_definition_ids WHERE root = ? AND phase = ? AND fact_id = ?`, root, key.Phase, key.FactID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func factKeysForDefinitionIDs(ctx context.Context, tx *sql.Tx, root string, ids []string) (map[factKey]bool, error) {
	keys := map[factKey]bool{}
	if len(ids) == 0 {
		return keys, nil
	}
	args := []any{root}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := tx.QueryContext(ctx, `SELECT phase, fact_id FROM index_fact_definition_ids WHERE root = ? AND definition_id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key factKey
		if err := rows.Scan(&key.Phase, &key.FactID); err != nil {
			return nil, err
		}
		keys[key] = true
	}
	return keys, rows.Err()
}

func relationIDsForFactKeys(ctx context.Context, tx *sql.Tx, root string, keys []factKey) ([]string, error) {
	seen := map[string]bool{}
	var ids []string
	for _, key := range keys {
		rows, err := tx.QueryContext(ctx, `SELECT relation_id FROM index_fact_relation_ids WHERE root = ? AND phase = ? AND fact_id = ?`, root, key.Phase, key.FactID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func factKeysForRelationIDs(ctx context.Context, tx *sql.Tx, root string, ids []string) (map[factKey]bool, error) {
	keys := map[factKey]bool{}
	if len(ids) == 0 {
		return keys, nil
	}
	args := []any{root}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := tx.QueryContext(ctx, `SELECT phase, fact_id FROM index_fact_relation_ids WHERE root = ? AND relation_id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key factKey
		if err := rows.Scan(&key.Phase, &key.FactID); err != nil {
			return nil, err
		}
		keys[key] = true
	}
	return keys, rows.Err()
}

func mapKeys[T comparable](values map[T]bool) []T {
	keys := make([]T, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func placeholders(count int) string {
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}
