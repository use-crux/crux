package commands

import (
	"context"
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
			return runCatalogList(cmd.Context(), f, kind, f.JSONOutput(*jsonOutput))
		},
	}
	cmd.Flags().StringVar(&kind, "kind", "", "Filter definitions by exact kind")
	return cmd
}

func newCatalogShowCmd(f *cli.Factory, jsonOutput *bool) *cobra.Command {
	return &cobra.Command{
		Use:   "show <definition-id>",
		Short: "Show one safe current Catalog definition",
		Example: `  crux catalog show prompt:my.prompt
  crux catalog show my.prompt --json`,
		Args: cli.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := f.ClientFor("catalog show")
			id, err := resolveCatalogDefinitionID(cmd.Context(), client, args[0], "crux catalog list")
			if err != nil {
				return err
			}
			var definition api.CatalogDefinitionV1
			if err := client.GetJSON(cmd.Context(), catalogDefinitionPath(id), &definition); err != nil {
				return catalogReadError(args[0], err, "crux catalog list")
			}
			if f.JSONOutput(*jsonOutput) {
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
			if err := f.ClientFor("catalog status").GetJSON(cmd.Context(), "/api/catalog/status", &status); err != nil {
				return err
			}
			if f.JSONOutput(*jsonOutput) {
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
		Example: `  crux catalog explain prompt:my.prompt
  crux catalog explain my.prompt --json`,
		Args: cli.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := f.ClientFor("catalog explain")
			id, err := resolveCatalogDefinitionID(cmd.Context(), client, args[0], "crux catalog list")
			if err != nil {
				return err
			}
			var explanation api.CatalogExplanationV1
			path := "/api/catalog/explain/" + url.PathEscape(id)
			if err := client.GetJSON(cmd.Context(), path, &explanation); err != nil {
				return catalogReadError(args[0], err, "crux catalog list")
			}
			if f.JSONOutput(*jsonOutput) {
				return writeCatalogJSON(f, explanation)
			}
			printCatalogExplanation(f.Streams(), explanation)
			return nil
		},
	}
}

func runCatalogList(ctx context.Context, f *cli.Factory, kind string, jsonOutput bool) error {
	return runCatalogListWithHeader(ctx, f, kind, jsonOutput, "catalog")
}

func runCatalogListWithHeader(ctx context.Context, f *cli.Factory, kind string, jsonOutput bool, header string) error {
	path := "/api/catalog"
	if kind != "" {
		path += "?" + url.Values{"kind": []string{kind}}.Encode()
	}
	var catalog api.CatalogListV1
	if err := f.ClientFor(header).GetJSON(ctx, path, &catalog); err != nil {
		return err
	}
	if jsonOutput {
		return writeCatalogJSON(f, catalog)
	}
	printCatalogListWithHeader(f.Streams(), catalog, header)
	return nil
}

func catalogDefinitionPath(id string) string {
	return "/api/catalog/" + url.PathEscape(id)
}

func writeCatalogJSON(f *cli.Factory, value any) error {
	return f.Streams().WriteJSON(value)
}
