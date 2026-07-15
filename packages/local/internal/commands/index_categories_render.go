package commands

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func printTools(io *output.IO, tools []api.ToolMeta) {
	if len(tools) == 0 {
		return
	}
	fmt.Fprintf(io.Out, "%s (%d)\n\n", io.Sprint(output.Bold, "Tools"), len(tools))
	table := &output.Table{Headers: []string{"ID", "DESCRIPTION"}}
	for _, tool := range tools {
		id := tool.ID
		if id == "" {
			id = tool.Name
		}
		description := ""
		if tool.Description != nil {
			description = truncate(*tool.Description, 60)
		}
		table.Rows = append(table.Rows, []string{
			io.Sprint(output.Magenta, id),
			description,
		})
	}
	fmt.Fprint(io.Out, io.RenderTable(table))
	fmt.Fprintln(io.Out)
}
