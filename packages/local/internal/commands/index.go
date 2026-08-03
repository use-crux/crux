package commands

import (
	"context"
	"fmt"
	"net/url"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewIndexCmd creates the compatibility alias for browsing every Catalog definition kind.
func NewIndexCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var reindexRoot string
	var reindexConfig string
	var reindexName string
	var reindexRuntimeRich bool

	cmd := &cobra.Command{
		Use:   "index [<definition-id>]",
		Short: "List every current Catalog definition, or show one by ID",
		Example: `  crux index
  crux index prompts
  crux index my.prompt.id
  crux index --json`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			filter := ""
			if len(args) == 1 {
				filter = args[0]
			}
			return runIndexCompatibility(cmd.Context(), f, filter, f.JSONOutput(jsonOutput))
		},
	}

	reindexCmd := &cobra.Command{
		Use:   "reindex",
		Short: "Rebuild the Project Index through the running dev server",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.ClientFor("index reindex")
			var index api.IndexData
			req := map[string]any{}
			if reindexRoot != "" {
				req["root"] = reindexRoot
			}
			if reindexConfig != "" {
				req["configPath"] = reindexConfig
			}
			if reindexName != "" {
				req["projectName"] = reindexName
			}
			if reindexRuntimeRich {
				req["runtimeRich"] = true
			}
			if err := c.PostJSON(cmd.Context(), "/api/project/index/reindex", req, &index); err != nil {
				return err
			}
			if f.JSONOutput(jsonOutput) {
				return f.Streams().WriteJSON(index)
			}
			io := f.Streams()
			fmt.Fprintf(io.Out, "%s indexed %d definitions, %d relations, %d diagnostics\n",
				io.Sprint(output.Green, "Project Index"),
				len(index.Definitions),
				len(index.Relations),
				len(index.Diagnostics),
			)
			if index.Project != nil {
				if index.Project.ConfigFile != "" {
					fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Dim, "config:"), index.Project.ConfigFile)
				}
				if index.Project.Root != "" {
					fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Dim, "root:"), index.Project.Root)
				}
			}
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	reindexCmd.Flags().StringVar(&reindexRoot, "root", "", "Project root to index (default: dev server working directory)")
	reindexCmd.Flags().StringVar(&reindexConfig, "config", "", "Crux config path relative to root")
	reindexCmd.Flags().StringVar(&reindexName, "name", "", "Project name to store in the index")
	reindexCmd.Flags().BoolVar(&reindexRuntimeRich, "runtime-rich", false, "Also run explicit runtime-rich Project Index evidence collection")
	cmd.AddCommand(reindexCmd)
	return cmd
}

type indexRoute struct {
	mode string
	path string
}

func indexCompatibilityRoute(argument string) indexRoute {
	if argument == "" {
		return indexRoute{mode: "catalog-list", path: "/api/catalog"}
	}
	if kind, ok := indexCatalogKind(argument); ok {
		return indexRoute{
			mode: "catalog-kind",
			path: "/api/catalog?" + url.Values{"kind": []string{kind}}.Encode(),
		}
	}
	if isIndexCategory(argument) {
		return indexRoute{mode: "legacy-category", path: "/api/index"}
	}
	return indexRoute{mode: "catalog-show", path: catalogDefinitionPath(argument)}
}

func runIndexCompatibility(ctx context.Context, f *cli.Factory, filter string, jsonOutput bool) error {
	route := indexCompatibilityRoute(filter)
	switch route.mode {
	case "catalog-list":
		return runCatalogListWithHeader(ctx, f, "", jsonOutput, "index")
	case "catalog-kind":
		kind, _ := indexCatalogKind(filter)
		return runCatalogListWithHeader(ctx, f, kind, jsonOutput, "index")
	case "catalog-show":
		client := f.ClientFor("index")
		id, err := resolveCatalogDefinitionID(ctx, client, filter, "crux index")
		if err != nil {
			return err
		}
		var definition api.CatalogDefinitionV1
		if err := client.GetJSON(ctx, catalogDefinitionPath(id), &definition); err != nil {
			return catalogReadError(filter, err, "crux index")
		}
		if jsonOutput {
			return writeCatalogJSON(f, definition)
		}
		printCatalogDefinitionWithHeader(f.Streams(), definition, "index show")
		return nil
	default:
		return runLegacyIndexCategory(ctx, f, filter, jsonOutput)
	}
}

func runLegacyIndexCategory(ctx context.Context, f *cli.Factory, filter string, jsonOutput bool) error {
	var index api.IndexData
	if err := f.ClientFor("index").GetJSON(ctx, "/api/index", &index); err != nil {
		return err
	}
	if jsonOutput {
		switch filter {
		case "prompts":
			return f.Streams().WriteJSON(index.Prompts)
		case "contexts":
			return f.Streams().WriteJSON(index.Contexts)
		case "tools":
			return f.Streams().WriteJSON(index.Tools)
		case "definitions":
			return f.Streams().WriteJSON(index.Definitions)
		default:
			return f.Streams().WriteJSON(index.Diagnostics)
		}
	}
	printIndex(f.Streams(), index, filter)
	return nil
}

func isIndexCategory(value string) bool {
	switch value {
	case "definitions", "diagnostics":
		return true
	default:
		return false
	}
}

func indexCatalogKind(value string) (string, bool) {
	switch value {
	case "prompts":
		return "prompt", true
	case "contexts":
		return "context", true
	case "tools":
		return "tool", true
	default:
		return "", false
	}
}

// printIndex renders the Project Index under a branded header: definitions,
// diagnostics, prompts, contexts, and tools, filtered to the requested category
// (empty filter shows all). Every styled span funnels through io.Sprint so
// `--no-color`/non-TTY output stays byte-clean; results go to io.Out (stdout).
func printIndex(io *output.IO, index api.IndexData, filter string) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "index"))

	if filter == "" || filter == "definitions" {
		printDefinitions(io, index.Definitions)
	}
	if filter == "" || filter == "diagnostics" {
		printDiagnostics(io, index.Diagnostics)
	}
	if filter == "" || filter == "prompts" {
		printPrompts(io, index.Prompts)
	}
	if filter == "" || filter == "contexts" {
		printContexts(io, index.Contexts)
	}
	if filter == "" || filter == "tools" {
		printTools(io, index.Tools)
	}

	if len(index.Definitions)+len(index.Prompts)+len(index.Contexts)+len(index.Tools) == 0 {
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No Catalog definitions found. Run `crux check` or `crux index reindex` to compile the project."))
	}
}

func printDefinitions(io *output.IO, definitions []api.ProjectDefinition) {
	if len(definitions) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Definitions"), len(definitions))
	tbl := &output.Table{Headers: []string{"ID", "KIND", "FIDELITY", "SOURCE"}}
	for _, d := range definitions {
		source := ""
		if d.Source != nil {
			source = fmt.Sprintf("%s:%d", d.Source.File, d.Source.Line)
		}
		tbl.Rows = append(tbl.Rows, []string{
			io.Sprint(output.Cyan, d.ID),
			d.Kind,
			d.Fidelity,
			io.Sprint(output.Dim, truncate(source, 60)),
		})
	}
	fmt.Fprint(io.Out, io.RenderTable(tbl))
	fmt.Fprintln(io.Out)
}

func printDiagnostics(io *output.IO, diagnostics []api.IndexDiagnostic) {
	if len(diagnostics) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Diagnostics"), len(diagnostics))
	tbl := &output.Table{Headers: []string{"SEV", "CODE", "MESSAGE"}}
	for _, d := range diagnostics {
		tbl.Rows = append(tbl.Rows, []string{
			d.Severity,
			d.Code,
			truncate(d.Message, 80),
		})
	}
	fmt.Fprint(io.Out, io.RenderTable(tbl))
	fmt.Fprintln(io.Out)
}

func printPrompts(io *output.IO, prompts []api.PromptMeta) {
	if len(prompts) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Prompts"), len(prompts))
	tbl := &output.Table{
		Headers: []string{"ID", "DESCRIPTION", "TAGS"},
	}
	for _, p := range prompts {
		desc := ""
		if p.Description != nil {
			desc = truncate(*p.Description, 50)
		}
		tags := ""
		if len(p.Tags) > 0 {
			for i, t := range p.Tags {
				if i > 0 {
					tags += ", "
				}
				tags += t
			}
		}
		tbl.Rows = append(tbl.Rows, []string{
			io.Sprint(output.Cyan, p.ID),
			desc,
			io.Sprint(output.Dim, tags),
		})
	}
	fmt.Fprint(io.Out, io.RenderTable(tbl))
	fmt.Fprintln(io.Out)
}

func printContexts(io *output.IO, contexts []api.ContextMeta) {
	if len(contexts) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Contexts"), len(contexts))
	tbl := &output.Table{
		Headers: []string{"ID", "DESCRIPTION"},
	}
	for _, c := range contexts {
		desc := ""
		if c.Description != nil {
			desc = truncate(*c.Description, 60)
		}
		tbl.Rows = append(tbl.Rows, []string{
			io.Sprint(output.Blue, c.ID),
			desc,
		})
	}
	fmt.Fprint(io.Out, io.RenderTable(tbl))
	fmt.Fprintln(io.Out)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}
