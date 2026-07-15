package commands

import (
	"context"
	"encoding/json"
	"net/url"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

func newCatalogListCmd(f *cli.Factory, jsonOutput *bool) *cobra.Command {
	var kind string
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List every current Catalog definition",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCatalogList(cmd.Context(), f, kind, *jsonOutput)
		},
	}
	cmd.Flags().StringVar(&kind, "kind", "", "Filter definitions by exact kind")
	return cmd
}

func newCatalogShowCmd(f *cli.Factory, jsonOutput *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "show <definition-id>",
		Short: "Show one safe current Catalog definition",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var definition api.CatalogDefinitionV1
			if err := f.Client().GetJSON(cmd.Context(), catalogDefinitionPath(args[0]), &definition); err != nil {
				return err
			}
			if *jsonOutput {
				return writeCatalogJSON(f, definition)
			}
			printCatalogDefinition(f.Streams(), definition)
			return nil
		},
	}
}

func newCatalogStatusCmd(f *cli.Factory, jsonOutput *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show current Catalog compiler and manifest status",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var status api.CatalogStatusV1
			if err := f.Client().GetJSON(cmd.Context(), "/api/catalog/status", &status); err != nil {
				return err
			}
			if *jsonOutput {
				return writeCatalogJSON(f, status)
			}
			printCatalogStatus(f.Streams(), status)
			return nil
		},
	}
}

func newCatalogExplainCmd(f *cli.Factory, jsonOutput *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "explain <definition-id>",
		Short: "Explain compiler-owned evidence for one current definition",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var explanation api.CatalogExplanationV1
			path := "/api/catalog/explain/" + url.PathEscape(args[0])
			if err := f.Client().GetJSON(cmd.Context(), path, &explanation); err != nil {
				return err
			}
			if *jsonOutput {
				return writeCatalogJSON(f, explanation)
			}
			printCatalogExplanation(f.Streams(), explanation)
			return nil
		},
	}
}

func runCatalogList(ctx context.Context, f *cli.Factory, kind string, jsonOutput bool) error {
	path := "/api/catalog"
	if kind != "" {
		path += "?" + url.Values{"kind": []string{kind}}.Encode()
	}
	var catalog api.CatalogListV1
	if err := f.Client().GetJSON(ctx, path, &catalog); err != nil {
		return err
	}
	if jsonOutput {
		return writeCatalogJSON(f, catalog)
	}
	printCatalogList(f.Streams(), catalog)
	return nil
}

func catalogDefinitionPath(id string) string {
	return "/api/catalog/" + url.PathEscape(id)
}

func writeCatalogJSON(f *cli.Factory, value any) error {
	encoder := json.NewEncoder(f.Streams().Out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
