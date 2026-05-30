package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/cli/internal/api"
	"github.com/use-crux/crux/packages/cli/internal/cli"
	"github.com/use-crux/crux/packages/cli/internal/output"
)

// NewCatalogCmd creates the "crux catalog" command for browsing registered prompts, contexts, and tools.
func NewCatalogCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var reindexRoot string
	var reindexConfig string
	var reindexName string

	cmd := &cobra.Command{
		Use:   "catalog [prompts|contexts|tools|definitions|diagnostics|<id>]",
		Short: "List registered Crux project catalog definitions",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
			var catalog api.CatalogData
			if err := c.GetJSON(cmd.Context(), "/api/catalog", &catalog); err != nil {
				return err
			}

			filter := ""
			if len(args) == 1 {
				filter = args[0]
			}

			// Check if arg is a specific item ID (not a category keyword).
			if filter != "" && filter != "prompts" && filter != "contexts" && filter != "tools" && filter != "definitions" && filter != "diagnostics" {
				return showCatalogItem(catalog, filter, jsonOutput)
			}

			if jsonOutput {
				switch filter {
				case "prompts":
					return output.JSON(catalog.Prompts)
				case "contexts":
					return output.JSON(catalog.Contexts)
				case "tools":
					return output.JSON(catalog.Tools)
				case "definitions":
					return output.JSON(catalog.Definitions)
				case "diagnostics":
					return output.JSON(catalog.Diagnostics)
				default:
					return output.JSON(catalog)
				}
			}

			if filter == "" || filter == "definitions" {
				printDefinitions(catalog.Definitions)
			}
			if filter == "" || filter == "diagnostics" {
				printDiagnostics(catalog.Diagnostics)
			}
			if filter == "" || filter == "prompts" {
				printPrompts(catalog.Prompts)
			}
			if filter == "" || filter == "contexts" {
				printContexts(catalog.Contexts)
			}
			if filter == "" || filter == "tools" {
				printTools(catalog.Tools)
			}

			if len(catalog.Definitions)+len(catalog.Prompts)+len(catalog.Contexts)+len(catalog.Tools) == 0 {
				fmt.Println(output.Dim.Render("No catalog entries found. Has the app sent a catalog event?"))
			}

			return nil
		},
	}

	reindexCmd := &cobra.Command{
		Use:   "reindex",
		Short: "Rebuild the Project Catalog through the running dev server",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
			var catalog api.CatalogData
			req := map[string]string{}
			if reindexRoot != "" {
				req["root"] = reindexRoot
			}
			if reindexConfig != "" {
				req["configPath"] = reindexConfig
			}
			if reindexName != "" {
				req["projectName"] = reindexName
			}
			if err := c.PostJSON(cmd.Context(), "/api/project/catalog/reindex", req, &catalog); err != nil {
				return err
			}
			if jsonOutput {
				return output.JSON(catalog)
			}
			fmt.Printf("%s indexed %d definitions, %d relations, %d diagnostics\n",
				output.Green.Render("Project Catalog"),
				len(catalog.Definitions),
				len(catalog.Relations),
				len(catalog.Diagnostics),
			)
			if catalog.Project != nil {
				if catalog.Project.ConfigFile != "" {
					fmt.Printf("%s %s\n", output.Dim.Render("config:"), catalog.Project.ConfigFile)
				}
				if catalog.Project.Root != "" {
					fmt.Printf("%s %s\n", output.Dim.Render("root:"), catalog.Project.Root)
				}
			}
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	reindexCmd.Flags().StringVar(&reindexRoot, "root", "", "Project root to index (default: dev server working directory)")
	reindexCmd.Flags().StringVar(&reindexConfig, "config", "", "Crux config path relative to root")
	reindexCmd.Flags().StringVar(&reindexName, "name", "", "Project name to store in the catalog")
	cmd.AddCommand(reindexCmd)
	return cmd
}

func printDefinitions(definitions []api.ProjectDefinition) {
	if len(definitions) == 0 {
		return
	}
	fmt.Printf("%s (%d)\n\n", output.Bold.Render("Definitions"), len(definitions))
	tbl := &output.Table{Headers: []string{"ID", "KIND", "FIDELITY", "SOURCE"}}
	for _, d := range definitions {
		source := ""
		if d.Source != nil {
			source = fmt.Sprintf("%s:%d", d.Source.File, d.Source.Line)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Cyan.Render(d.ID),
			d.Kind,
			d.Fidelity,
			output.Dim.Render(truncate(source, 60)),
		})
	}
	tbl.Print()
	fmt.Println()
}

func printDiagnostics(diagnostics []api.CatalogDiagnostic) {
	if len(diagnostics) == 0 {
		return
	}
	fmt.Printf("%s (%d)\n\n", output.Bold.Render("Diagnostics"), len(diagnostics))
	tbl := &output.Table{Headers: []string{"SEV", "CODE", "MESSAGE"}}
	for _, d := range diagnostics {
		tbl.Rows = append(tbl.Rows, []string{
			d.Severity,
			d.Code,
			truncate(d.Message, 80),
		})
	}
	tbl.Print()
	fmt.Println()
}

func printPrompts(prompts []api.PromptMeta) {
	if len(prompts) == 0 {
		return
	}
	fmt.Printf("%s (%d)\n\n", output.Bold.Render("Prompts"), len(prompts))
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
			output.Cyan.Render(p.ID),
			desc,
			output.Dim.Render(tags),
		})
	}
	tbl.Print()
	fmt.Println()
}

func printContexts(contexts []api.ContextMeta) {
	if len(contexts) == 0 {
		return
	}
	fmt.Printf("%s (%d)\n\n", output.Bold.Render("Contexts"), len(contexts))
	tbl := &output.Table{
		Headers: []string{"ID", "DESCRIPTION"},
	}
	for _, c := range contexts {
		desc := ""
		if c.Description != nil {
			desc = truncate(*c.Description, 60)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Blue.Render(c.ID),
			desc,
		})
	}
	tbl.Print()
	fmt.Println()
}

func printTools(tools []api.ToolMeta) {
	if len(tools) == 0 {
		return
	}
	fmt.Printf("%s (%d)\n\n", output.Bold.Render("Tools"), len(tools))
	tbl := &output.Table{
		Headers: []string{"ID", "DESCRIPTION"},
	}
	for _, t := range tools {
		id := t.ID
		if id == "" {
			id = t.Name
		}
		desc := ""
		if t.Description != nil {
			desc = truncate(*t.Description, 60)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Magenta.Render(id),
			desc,
		})
	}
	tbl.Print()
	fmt.Println()
}

func showCatalogItem(catalog api.CatalogData, id string, jsonOut bool) error {
	for _, definition := range catalog.Definitions {
		if definition.ID == id {
			if jsonOut {
				return output.JSON(definition)
			}
			fmt.Printf("%s %s\n", output.Bold.Render("Definition:"), output.BoldCyan.Render(definition.ID))
			fmt.Printf("  %s %s\n", output.Bold.Render("Kind:"), definition.Kind)
			fmt.Printf("  %s %s\n", output.Bold.Render("Fidelity:"), definition.Fidelity)
			if definition.Description != "" {
				fmt.Printf("  %s\n", definition.Description)
			}
			if definition.Source != nil {
				fmt.Printf("  %s %s:%d\n", output.Bold.Render("Source:"), definition.Source.File, definition.Source.Line)
			}
			fmt.Println()
			return nil
		}
	}

	// Search prompts.
	for _, p := range catalog.Prompts {
		if p.ID == id {
			if jsonOut {
				return output.JSON(p)
			}
			fmt.Printf("%s %s\n", output.Bold.Render("Prompt:"), output.BoldCyan.Render(p.ID))
			if p.Description != nil {
				fmt.Printf("  %s\n", *p.Description)
			}
			if len(p.Tags) > 0 {
				fmt.Printf("  %s %s\n", output.Bold.Render("Tags:"), output.Dim.Render(strings.Join(p.Tags, ", ")))
			}
			if len(p.Path) > 0 {
				fmt.Printf("  %s %s\n", output.Bold.Render("Path:"), output.Dim.Render(strings.Join(p.Path, " → ")))
			}
			if len(p.ContextIDs) > 0 {
				fmt.Printf("\n  %s\n", output.Bold.Render("Contexts"))
				for _, cid := range p.ContextIDs {
					fmt.Printf("    %s %s\n", output.Blue.Render("→"), cid)
				}
			}
			fmt.Println()
			return nil
		}
	}

	// Search contexts.
	for _, c := range catalog.Contexts {
		if c.ID == id {
			if jsonOut {
				return output.JSON(c)
			}
			fmt.Printf("%s %s\n", output.Bold.Render("Context:"), output.Blue.Render(c.ID))
			if c.Description != nil {
				fmt.Printf("  %s\n", *c.Description)
			}
			if len(c.Path) > 0 {
				fmt.Printf("  %s %s\n", output.Bold.Render("Path:"), output.Dim.Render(strings.Join(c.Path, " → ")))
			}
			fmt.Println()
			return nil
		}
	}

	// Search tools.
	for _, t := range catalog.Tools {
		toolID := t.ID
		if toolID == "" {
			toolID = t.Name
		}
		if toolID == id {
			if jsonOut {
				return output.JSON(t)
			}
			fmt.Printf("%s %s\n", output.Bold.Render("Tool:"), output.Magenta.Render(toolID))
			if t.Description != nil {
				fmt.Printf("  %s\n", *t.Description)
			}
			fmt.Println()
			return nil
		}
	}

	return fmt.Errorf("catalog item %q not found", id)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}
