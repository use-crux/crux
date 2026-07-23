package commands

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	lspserver "github.com/use-crux/crux/packages/local/internal/lsp/server"
)

// NewLSPCmd creates the stdio Language Server Protocol command.
func NewLSPCmd(f *cli.Factory) *cobra.Command {
	if f == nil {
		f = &cli.Factory{}
	}
	root := "."
	command := &cobra.Command{
		Use:   "lsp",
		Short: "Run the Crux language server over stdio",
		Args:  cobra.NoArgs,
		RunE: func(command *cobra.Command, _ []string) error {
			port := f.Port
			if port == 0 {
				port = 4400
			}
			server := lspserver.New(lspserver.Options{
				Version: command.Root().Version,
				Root:    root,
				Port:    port,
				Logs:    command.ErrOrStderr(),
			})
			if err := jsonrpc.Serve(command.Context(), command.InOrStdin(), command.OutOrStdout(), command.ErrOrStderr(), server); err != nil {
				fmt.Fprintf(command.ErrOrStderr(), "crux lsp: %v\n", err)
				return domain.ExitError{Code: 1}
			}
			if server.ExitCode() != 0 {
				return domain.ExitError{Code: server.ExitCode()}
			}
			return nil
		},
	}
	command.Flags().StringVar(&root, "root", ".", "Fallback project root when the client provides no workspace")
	return command
}
