package commands

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func resolveCatalogDefinitionID(ctx context.Context, client *api.Client, id string) (string, error) {
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
		return "", catalogDefinitionNotFound(id)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("definition ID %q is ambiguous; use one of: %s", id, strings.Join(matches, ", "))
	}
}

func catalogDefinitionNotFound(id string) error {
	return fmt.Errorf("Catalog definition %q not found; expected a bare ID or kind-prefixed ID such as prompt:%s", id, id)
}

func catalogReadError(id string, err error) error {
	if errors.Is(err, api.ErrNotFound) {
		return catalogDefinitionNotFound(id)
	}
	return err
}
