package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// NewIndexCmd creates the "crux index" command for browsing registered prompts, contexts, and tools.
func NewIndexCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var reindexRoot string
	var reindexConfig string
	var reindexName string
	var reindexRuntimeRich bool

	cmd := &cobra.Command{
		Use:   "index [prompts|contexts|tools|definitions|diagnostics|<id>]",
		Short: "List registered Crux project index definitions",
		Example: `  crux index
  crux index prompts
  crux index my.prompt.id
  crux index --json`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
			var index api.IndexData
			if err := c.GetJSON(cmd.Context(), "/api/index", &index); err != nil {
				return err
			}

			filter := ""
			if len(args) == 1 {
				filter = args[0]
			}

			// Check if arg is a specific item ID (not a category keyword).
			if filter != "" && filter != "prompts" && filter != "contexts" && filter != "tools" && filter != "definitions" && filter != "diagnostics" {
				return showIndexItem(f.Streams(), index, filter, jsonOutput)
			}

			if jsonOutput {
				switch filter {
				case "prompts":
					return output.JSON(index.Prompts)
				case "contexts":
					return output.JSON(index.Contexts)
				case "tools":
					return output.JSON(index.Tools)
				case "definitions":
					return output.JSON(index.Definitions)
				case "diagnostics":
					return output.JSON(index.Diagnostics)
				default:
					return output.JSON(index)
				}
			}

			printIndex(f.Streams(), index, filter)
			return nil
		},
	}

	reindexCmd := &cobra.Command{
		Use:   "reindex",
		Short: "Rebuild the Project Index through the running dev server",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := f.Client()
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
			if jsonOutput {
				return output.JSON(index)
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
		fmt.Fprintln(io.Out, "  "+io.Sprint(output.Dim, "No index entries found. Has the app sent an index event?"))
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
	fmt.Fprint(io.Out, tbl.Render())
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
	fmt.Fprint(io.Out, tbl.Render())
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
	fmt.Fprint(io.Out, tbl.Render())
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
	fmt.Fprint(io.Out, tbl.Render())
	fmt.Fprintln(io.Out)
}

func printTools(io *output.IO, tools []api.ToolMeta) {
	if len(tools) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Tools"), len(tools))
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
			io.Sprint(output.Magenta, id),
			desc,
		})
	}
	fmt.Fprint(io.Out, tbl.Render())
	fmt.Fprintln(io.Out)
}

// showIndexItem renders one index entry (definition, prompt, context, or tool)
// matched by id. Styled spans funnel through io.Sprint so `--no-color`/non-TTY
// output stays byte-clean; the --json branch returns the raw record unchanged.
func showIndexItem(io *output.IO, index api.IndexData, id string, jsonOut bool) error {
	for _, definition := range index.Definitions {
		if definition.ID == id {
			if jsonOut {
				return output.JSON(definition)
			}
			fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Bold, "Definition:"), io.Sprint(output.BoldCyan, definition.ID))
			fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Bold, "Kind:"), definition.Kind)
			fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Bold, "Fidelity:"), definition.Fidelity)
			if definition.Description != "" {
				fmt.Fprintf(io.Out, "  %s\n", definition.Description)
			}
			if definition.Source != nil {
				fmt.Fprintf(io.Out, "  %s %s:%d\n", io.Sprint(output.Bold, "Source:"), definition.Source.File, definition.Source.Line)
			}
			fmt.Fprintln(io.Out)
			return nil
		}
	}

	// Search prompts.
	for _, p := range index.Prompts {
		if p.ID == id {
			if jsonOut {
				return output.JSON(p)
			}
			fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Bold, "Prompt:"), io.Sprint(output.BoldCyan, p.ID))
			if p.Description != nil {
				fmt.Fprintf(io.Out, "  %s\n", *p.Description)
			}
			if len(p.Tags) > 0 {
				fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Bold, "Tags:"), io.Sprint(output.Dim, strings.Join(p.Tags, ", ")))
			}
			if len(p.Path) > 0 {
				fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Bold, "Path:"), io.Sprint(output.Dim, strings.Join(p.Path, " → ")))
			}
			if len(p.ContextIDs) > 0 {
				fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Contexts"))
				for _, cid := range p.ContextIDs {
					fmt.Fprintf(io.Out, "    %s %s\n", io.Sprint(output.Blue, "→"), cid)
				}
			}
			fmt.Fprintln(io.Out)
			return nil
		}
	}

	// Search contexts.
	for _, c := range index.Contexts {
		if c.ID == id {
			if jsonOut {
				return output.JSON(c)
			}
			fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Bold, "Context:"), io.Sprint(output.Blue, c.ID))
			if c.Description != nil {
				fmt.Fprintf(io.Out, "  %s\n", *c.Description)
			}
			if len(c.Path) > 0 {
				fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Bold, "Path:"), io.Sprint(output.Dim, strings.Join(c.Path, " → ")))
			}
			fmt.Fprintln(io.Out)
			return nil
		}
	}

	// Search tools.
	for _, t := range index.Tools {
		toolID := t.ID
		if toolID == "" {
			toolID = t.Name
		}
		if toolID == id {
			if jsonOut {
				return output.JSON(t)
			}
			fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Bold, "Tool:"), io.Sprint(output.Magenta, toolID))
			if t.Description != nil {
				fmt.Fprintf(io.Out, "  %s\n", *t.Description)
			}
			fmt.Fprintln(io.Out)
			return nil
		}
	}

	return fmt.Errorf("index item %q not found", id)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}
