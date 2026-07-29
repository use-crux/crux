// Package editorcmd installs the version-matched Crux editor extension.
package editorcmd

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

var releaseVersionPattern = regexp.MustCompile(
	`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`,
)

type installOperation func(context.Context, installRequest) (installResult, error)

// New creates the editor integration command group.
func New(factory *cli.Factory) *cobra.Command {
	extensionInstaller := newInstaller(installerDependencies{
		runEditor: func(ctx context.Context, executable string, arguments []string) error {
			streams := factory.Streams()
			command := exec.CommandContext(ctx, executable, arguments...)
			command.Stdin = streams.In
			command.Stdout = streams.Out
			command.Stderr = streams.Err
			return command.Run()
		},
	})
	return newCommand(factory, extensionInstaller.install)
}

func newCommand(factory *cli.Factory, install installOperation) *cobra.Command {
	var downloadDirectory string
	editorCommand := &cobra.Command{
		Use:   "editor",
		Short: "Manage Crux editor integrations",
		Args:  cobra.NoArgs,
		Example: `  crux editor install vscode
  crux editor install cursor`,
	}
	installCommand := &cobra.Command{
		Use:       "install <vscode|cursor>",
		Short:     "Install the matching Crux editor extension",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{string(editorVSCode), string(editorCursor)},
		Example: `  crux editor install vscode
  crux editor install cursor
  crux editor install vscode --download-only ./artifacts`,
		RunE: func(command *cobra.Command, arguments []string) error {
			version := command.Root().Version
			if !releaseVersionPattern.MatchString(version) {
				return fmt.Errorf(
					"Crux version %q does not identify a published GitHub Release",
					version,
				)
			}
			target := editor(arguments[0])
			if _, err := target.executable(); err != nil {
				return err
			}
			result, err := install(command.Context(), installRequest{
				version:     version,
				editor:      target,
				downloadDir: downloadDirectory,
			})
			if err != nil {
				return err
			}
			if downloadDirectory != "" {
				_, err = fmt.Fprintf(
					factory.Streams().Out,
					"Downloaded verified Crux %s extension to %s.\n",
					version,
					result.outputPath,
				)
				return err
			}
			_, err = fmt.Fprintf(
				factory.Streams().Out,
				"Installed Crux %s for %s.\n",
				version,
				target.label(),
			)
			return err
		},
	}
	installCommand.Flags().StringVar(
		&downloadDirectory,
		"download-only",
		"",
		"Download the verified VSIX to a directory without running an editor",
	)
	editorCommand.AddCommand(installCommand)
	return editorCommand
}
