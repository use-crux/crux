package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type runtimeGenerateOptions struct {
	jsonOutput bool
	cwd        string
}

type runtimeArtifactGenerateFunc func(ctx context.Context, root string) (json.RawMessage, error)
type runtimeOperationFunc func(ctx context.Context, root, operation, workID string) (json.RawMessage, error)
type setupOperationFunc func(ctx context.Context, root, mode string) (json.RawMessage, error)

var generateRuntimeArtifactsForCommand runtimeArtifactGenerateFunc = generateRuntimeArtifactsWithWorker
var runRuntimeOperationForCommand runtimeOperationFunc = runRuntimeOperationWithWorker
var runSetupOperationForCommand setupOperationFunc = runSetupOperationWithWorker

const runtimeGenerateTimeout = 120 * time.Second

// NewRuntimeCmd creates the "crux runtime" command group.
func NewRuntimeCmd(f *cli.Factory) *cobra.Command {
	opts := &runtimeGenerateOptions{}
	cmd := &cobra.Command{
		Use:     "runtime",
		Short:   "Generate and operate Crux Runtime Engine artifacts",
		Example: "  crux runtime generate",
	}
	cmd.PersistentFlags().BoolVar(&opts.jsonOutput, "json", false, "Output result as JSON")
	cmd.PersistentFlags().StringVar(&opts.cwd, "cwd", "", "Project root to operate on (default: nearest config or package root)")

	generateCmd := &cobra.Command{
		Use:   "generate",
		Short: "Generate Runtime Engine manifest and host entry files",
		Long: `Generate the Runtime Engine manifest and host entry files for the current project.

The command discovers exported flow() handles and durableTask() targets, writes
.crux/generated/runtime/manifest.json, and refreshes the default Next and Convex
entry files. It does not create infrastructure or mutate runtime state.`,
		Example: `  crux runtime generate
  crux runtime generate --cwd packages/app
  crux runtime generate --json`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if !startupDebugEnabled(false) {
				slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
			}
			root, err := resolveRuntimeGenerateRoot(opts.cwd)
			if err != nil {
				return err
			}
			result, err := generateRuntimeArtifactsForCommand(cmd.Context(), root)
			if err != nil {
				return err
			}
			if opts.jsonOutput {
				return writePrettyJSON(cmd.OutOrStdout(), result)
			}
			if err := printRuntimeGenerateResult(f.Streams(), result); err != nil {
				return err
			}
			printRuntimeGeneratePreflight(f.Streams(), root, result)
			return nil
		},
	}
	cmd.AddCommand(generateCmd)
	cmd.AddCommand(newRuntimeStatusCmd(f, opts))
	cmd.AddCommand(newRuntimeInspectCmd(f, opts))
	cmd.AddCommand(newRuntimeRetryCmd(f, opts))
	cmd.AddCommand(newRuntimeCancelCmd(f, opts))
	return cmd
}

func resolveRuntimeGenerateRoot(cwd string) (string, error) {
	if cwd != "" {
		return filepath.Abs(cwd)
	}
	if root := findProjectDir(); root != "" {
		return root, nil
	}
	return os.Getwd()
}

func generateRuntimeArtifactsWithWorker(ctx context.Context, root string) (json.RawMessage, error) {
	worker := assets.NewEmbeddedProjectIndexer("")
	defer worker.Close()
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, runtimeGenerateTimeout)
		defer cancel()
	}
	astResult, err := worker.IndexProjectAstPatchWithResult(ctx, root, "", "")
	if err != nil {
		return nil, err
	}
	index := projectindex.ApplyPatch(projectindex.EmptyPatchState(), astResult.Patch).Index
	return worker.GenerateRuntimeArtifacts(ctx, root, index.Definitions)
}

func runRuntimeOperationWithWorker(ctx context.Context, root, operation, workID string) (json.RawMessage, error) {
	worker := assets.NewEmbeddedProjectIndexer("")
	defer worker.Close()
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, runtimeGenerateTimeout)
		defer cancel()
	}
	return worker.RunRuntimeOperation(ctx, root, operation, workID, false)
}

func runSetupOperationWithWorker(ctx context.Context, root, mode string) (json.RawMessage, error) {
	worker := assets.NewEmbeddedProjectIndexer("")
	defer worker.Close()
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, runtimeGenerateTimeout)
		defer cancel()
	}
	return worker.RunSetupOperation(ctx, root, mode)
}

func printRuntimeGenerateResult(io *output.IO, raw json.RawMessage) error {
	var result runtimeGenerateResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime generation result: %w", err)
	}
	fmt.Fprintf(io.Out, "%s generated %d runtime targets, %d Evals, %d files\n",
		io.Sprint(output.Green, "Runtime"),
		len(result.Manifest.Targets),
		len(result.Manifest.Evals),
		len(result.WrittenFiles),
	)
	fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Dim, "hash:"), result.ContentHash)
	for _, file := range result.WrittenFiles {
		fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Dim, "wrote:"), file)
	}
	return nil
}

type runtimeGenerateResult struct {
	Manifest     runtimeManifest `json:"manifest"`
	ContentHash  string          `json:"contentHash"`
	WrittenFiles []string        `json:"writtenFiles"`
}

type runtimeManifest struct {
	Targets []runtimeManifestTarget `json:"targets"`
	Evals   []runtimeManifestEval   `json:"evals"`
}

type runtimeManifestTarget struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type runtimeManifestEval struct {
	ID string `json:"id"`
}
