package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/anthropics/crux-cli/internal/cli"
	"github.com/anthropics/crux-cli/internal/commands"
	"github.com/anthropics/crux-cli/internal/domain"
	"github.com/anthropics/crux-cli/internal/output"
	"github.com/spf13/cobra"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	f := &cli.Factory{}

	rootCmd := &cobra.Command{
		Use:     "crux",
		Short:   " ",
		Version: version,
		CompletionOptions: cobra.CompletionOptions{
			HiddenDefaultCmd: true,
		},
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			if f.NoColor {
				os.Setenv("NO_COLOR", "1")
			}
		},
	}

	rootCmd.SetUsageFunc(func(cmd *cobra.Command) error {
		w := func(cmd, desc string) {
			fmt.Printf("    %-12s %s\n", output.Accent.Render(cmd), desc)
		}
		fl := func(flag, desc string) {
			fmt.Printf("    %-12s %s\n", output.Dim.Render(flag), desc)
		}
		fmt.Println()
		fmt.Printf("  %s\n\n", output.Logo("— context engineering devtools"))
		fmt.Printf("  %s\n", output.Bold.Render("Usage"))
		fmt.Printf("    crux <command> [flags]\n\n")
		fmt.Printf("  %s\n", output.Bold.Render("Observe"))
		w("traces", "List recent traces or show trace detail")
		w("stats", "Show aggregate statistics")
		w("cost", "Show tracked model cost")
		w("catalog", "List registered prompts, contexts, and tools")
		w("lint", "Check authored Crux project health")
		w("inspect", "Show token breakdown for a prompt")
		fmt.Println()
		fmt.Printf("  %s\n", output.Bold.Render("Evaluate"))
		w("eval", "Run prompt and flow evals")
		w("evals", "List past eval runs")
		w("quality", "List local quality workbench records")
		w("flows", "Runtime flow sessions")
		fmt.Println()
		fmt.Printf("  %s\n", output.Bold.Render("Server"))
		w("dev", "Start the devtools server")
		fmt.Println()
		fmt.Printf("  %s\n", output.Bold.Render("Flags"))
		fl("--port", "Devtools server port (default 4400)")
		fl("--no-color", "Disable colored output")
		fl("--json", "JSON output (on subcommands)")
		fmt.Println()
		fmt.Printf("  %s\n\n", output.Dim.Render("Run crux <command> --help for command-specific flags"))
		return nil
	})

	rootCmd.PersistentFlags().IntVar(&f.Port, "port", 4400, "Devtools server port")
	rootCmd.PersistentFlags().BoolVar(&f.NoColor, "no-color", false, "Disable colored output")

	rootCmd.AddCommand(commands.NewDevCmd())
	rootCmd.AddCommand(commands.NewEvalCmd())
	rootCmd.AddCommand(commands.NewTracesCmd(f))
	rootCmd.AddCommand(commands.NewCatalogCmd(f))
	rootCmd.AddCommand(commands.NewLintCmd(f))
	rootCmd.AddCommand(commands.NewStatsCmd(f))
	rootCmd.AddCommand(commands.NewCostCmd(f))
	rootCmd.AddCommand(commands.NewEvalsCmd(f))
	rootCmd.AddCommand(commands.NewQualityCmd(f))
	rootCmd.AddCommand(commands.NewFlowsCmd(f))
	rootCmd.AddCommand(commands.NewInspectCmd(f))

	if err := rootCmd.ExecuteContext(ctx); err != nil {
		var exitErr domain.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.Code)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
