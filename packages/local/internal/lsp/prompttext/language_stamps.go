package prompttext

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func navigationDocumentStamps(
	view *promptview.View,
	result NavigationResult,
) ([]string, []promptview.DocumentStamp) {
	files := make(map[string]struct{})
	if result.Definition != nil {
		addProtocolLocationFile(files, *result.Definition)
	}
	for _, location := range result.References {
		addProtocolLocationFile(files, location)
	}
	return documentStampsForFiles(view, files)
}

func hoverDocumentStamps(
	view *promptview.View,
	refs []promptview.PromptTextSourceRef,
	ownerIDs []string,
) ([]string, []promptview.DocumentStamp) {
	files := make(map[string]struct{})
	keys := make(map[promptview.SourceRefKey]struct{}, len(refs))
	for _, ref := range refs {
		keys[ref.Key] = struct{}{}
		files[ref.Template.File] = struct{}{}
	}
	owners := make(map[string]struct{}, len(ownerIDs))
	for _, id := range ownerIDs {
		owners[id] = struct{}{}
	}
	for _, definition := range view.Definitions {
		if _, contributes := owners[definition.ID]; contributes {
			files[definition.Location.File] = struct{}{}
		}
	}
	for _, join := range view.FragmentJoins {
		owner := promptview.SourceRefKey{
			DefinitionID: join.Key.DefinitionID,
			SourceRefID:  join.Key.OwnerSourceRefID,
		}
		target := promptview.SourceRefKey{
			DefinitionID: join.Key.DefinitionID,
			SourceRefID:  join.Key.TargetSourceRefID,
		}
		_, ownerContributes := keys[owner]
		_, targetContributes := keys[target]
		if ownerContributes || targetContributes {
			files[join.OwnerTemplate.File] = struct{}{}
			files[join.Expression.File] = struct{}{}
			files[join.TargetTemplate.File] = struct{}{}
		}
	}
	return documentStampsForFiles(view, files)
}

func addProtocolLocationFile(
	files map[string]struct{},
	location protocol.Location,
) {
	if file, err := mapping.URIToPath(string(location.URI)); err == nil {
		files[file] = struct{}{}
	}
}

func documentStampsForFiles(
	view *promptview.View,
	files map[string]struct{},
) ([]string, []promptview.DocumentStamp) {
	if len(files) == 0 {
		return nil, nil
	}
	contributing := make([]string, 0, len(files))
	for file := range files {
		contributing = append(contributing, file)
	}
	sort.Strings(contributing)
	if view == nil {
		return contributing, nil
	}
	result := make([]promptview.DocumentStamp, 0, len(files))
	for _, document := range view.Documents {
		if _, contributes := files[document.File]; contributes {
			result = append(result, document)
		}
	}
	return contributing, result
}
