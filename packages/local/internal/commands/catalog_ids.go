package commands

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func resolveCatalogDefinitionID(ctx context.Context, client *api.Client, id, listCommand string) (string, error) {
	if strings.Contains(id, ":") {
		return id, nil
	}
	var catalog api.CatalogListV1
	if err := client.GetJSON(ctx, "/api/catalog", &catalog); err != nil {
		return "", err
	}
	var matches []string
	for _, definition := range catalog.Definitions {
		_, bare, prefixed := strings.Cut(definition.ID, ":")
		if definition.ID == id || prefixed && bare == id {
			matches = append(matches, definition.ID)
		}
	}
	sort.Strings(matches)
	switch len(matches) {
	case 0:
		return "", catalogDefinitionNotFound(id, listCommand)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("definition ID %q is ambiguous; use one of: %s", id, strings.Join(matches, ", "))
	}
}

func catalogDefinitionNotFound(id, listCommand string) error {
	return fmt.Errorf(
		"Catalog definition %q not found; expected a bare ID like my.prompt or a kind-prefixed ID like prompt:my.prompt. Run `%s` to list available definitions",
		id,
		listCommand,
	)
}

func catalogReadError(id string, err error, listCommand string) error {
	if errors.Is(err, api.ErrNotFound) {
		return catalogDefinitionNotFound(id, listCommand)
	}
	return err
}
