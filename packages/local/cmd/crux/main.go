package main

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/commands"
	"github.com/use-crux/crux/packages/local/internal/commands/editorcmd"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

var version = "dev"

func main() {
	factory := &cli.Factory{}
	os.Exit(runCLI(
		context.Background(),
		factory,
		processSignalNotifier{},
		os.Args[1:],
	))
}

func newRootCommand(f *cli.Factory) *cobra.Command {
	rootCmd := &cobra.Command{
		Use:           "crux",
		Short:         " ",
		Version:       version,
		SilenceErrors: true,
		SilenceUsage:  true,
		// Keep cobra's built-in `completion [bash|zsh|fish|powershell]` command
		// visible so users can discover and install shell completions
		// (clig.dev R7: discoverability). Cobra registers it lazily during
		// Execute; HiddenDefaultCmd=false makes it appear in help listings.
		CompletionOptions: cobra.CompletionOptions{
			HiddenDefaultCmd: false,
		},
	}
	rootCmd.SetIn(factoryInput{factory: f})
	rootCmd.SetOut(factoryOutput{factory: f})
	rootCmd.SetErr(factoryOutput{factory: f, diagnostic: true})

	rootCmd.SetHelpFunc(rootHelpFunc(rootCmd, f))

	rootCmd.PersistentFlags().IntVar(&f.Port, "port", 4400, "Devtools server port")
	rootCmd.PersistentFlags().BoolVar(&f.NoColor, "no-color", false, "Disable colored output")
	rootCmd.PersistentFlags().BoolVar(&f.JSON, "json", false, "Output JSON when the selected command supports it")
	rootCmd.PersistentPreRunE = func(cmd *cobra.Command, _ []string) error {
		if f.JSON && !commandSupportsJSON(cmd) {
			fmt.Fprintf(cmd.ErrOrStderr(), "%s has no JSON output yet\n", cmd.CommandPath())
			return domain.ExitError{Code: 2}
		}
		return nil
	}

	rootCmd.AddCommand(commands.NewDevCmd(f))
	rootCmd.AddCommand(commands.NewConfigCmd(f))
	rootCmd.AddCommand(commands.NewTracesCmd(f))
	rootCmd.AddCommand(commands.NewIndexCmd(f))
	rootCmd.AddCommand(commands.NewLintCmd(f))
	rootCmd.AddCommand(commands.NewLSPCmd(f))
	rootCmd.AddCommand(commands.NewCheckCmd(f))
	rootCmd.AddCommand(commands.NewManifestCmd(f))
	rootCmd.AddCommand(commands.NewCatalogCmd(f))
	rootCmd.AddCommand(commands.NewStatsCmd(f))
	rootCmd.AddCommand(commands.NewCostCmd(f))
	rootCmd.AddCommand(commands.NewEvalCmd(f))
	rootCmd.AddCommand(commands.NewFlowsCmd(f))
	rootCmd.AddCommand(commands.NewInspectCmd(f))
	rootCmd.AddCommand(commands.NewRuntimeCmd(f))
	rootCmd.AddCommand(commands.NewSetupCmd(f))
	rootCmd.AddCommand(editorcmd.New(f))

	return rootCmd
}

func rootHelpFunc(rootCmd *cobra.Command, f *cli.Factory) func(*cobra.Command, []string) {
	return func(cmd *cobra.Command, _ []string) {
		if cmd != rootCmd {
			printCommandHelp(cmd)
			return
		}
		_ = printRootUsage(cmd, f.Streams())
	}
}

func printCommandHelp(cmd *cobra.Command) {
	out := cmd.OutOrStdout()
	if cmd.Long != "" {
		fmt.Fprintln(out, cmd.Long)
		fmt.Fprintln(out)
	} else if cmd.Short != "" {
		fmt.Fprintln(out, cmd.Short)
		fmt.Fprintln(out)
	}
	fmt.Fprint(out, cmd.UsageString())
}

func printRootUsage(cmd *cobra.Command, io *output.IO) error {
	out := cmd.OutOrStdout()
	w := func(cmd, desc string) {
		fmt.Fprintf(out, "    %-12s %s\n", io.Sprint(output.Accent, cmd), desc)
	}
	fl := func(flag, desc string) {
		fmt.Fprintf(out, "    %-12s %s\n", io.Sprint(output.Dim, flag), desc)
	}
	fmt.Fprintln(out)
	logo := io.Sprint(output.Accent.Bold(true), output.LogoMark+" crux")
	fmt.Fprintf(out, "  %s %s\n\n", logo, io.Sprint(output.Dim, "- context engineering devtools"))
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Usage"))
	fmt.Fprintf(out, "    crux <command> [flags]\n\n")
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Evals"))
	w("eval", "Run Evals and inspect Eval runs and Baselines")
	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Observe"))
	w("config", "Inspect resolved config and source discovery")
	w("traces", "List recent traces or show trace detail")
	w("flows", "List runtime flow sessions")
	w("stats", "Show aggregate statistics")
	w("cost", "Show tracked model cost")
	w("index", "List every current Catalog definition")
	w("lint", "Check authored Crux project health")
	w("check", "Compile and gate authored Crux project health")
	w("manifest", "Build a deployment Project Index manifest")
	w("catalog", "Inspect and import Project Index catalog data")
	w("inspect", "Show token breakdown for a prompt")
	w("runtime", "Generate Runtime Engine artifacts")
	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Integrate"))
	w("editor", "Install and manage editor integrations")
	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Server"))
	w("dev", "Start the devtools server")
	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s\n", io.Sprint(output.Bold, "Flags"))
	fl("--port", "Devtools server port (default 4400)")
	fl("--no-color", "Disable colored output")
	fl("--json", "Output JSON for supported commands; unsupported commands error")
	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s\n\n", io.Sprint(output.Dim, "Run crux eval --help for the Eval workflow"))
	return nil
}

func commandSupportsJSON(cmd *cobra.Command) bool {
	if cmd.LocalNonPersistentFlags().Lookup("json") != nil {
		return true
	}
	for current := cmd; current != nil && current.Parent() != nil; current = current.Parent() {
		if current.PersistentFlags().Lookup("json") != nil {
			return true
		}
	}
	return false
}
