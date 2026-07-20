package commands

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
)

type manifestOptions struct {
	root       string
	configPath string
	projectID  string
	out        string
	json       bool
}

type manifestCompileFunc func(context.Context, manifestOptions) ([]byte, error)

type manifestJSONSummaryV1 struct {
	SchemaVersion  int    `json:"schemaVersion"`
	ProjectID      string `json:"projectId"`
	ManifestID     string `json:"manifestId"`
	Definitions    int    `json:"definitions"`
	Relations      int    `json:"relations"`
	SemanticStatus string `json:"semanticStatus"`
	Output         string `json:"output"`
}

// NewManifestCmd creates the daemon-free deployment manifest command.
func NewManifestCmd(f *cli.Factory) *cobra.Command {
	opts := manifestOptions{}
	cmd := &cobra.Command{
		Use:   "manifest",
		Short: "Build a content-addressed Project Index deployment manifest",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runManifest(cmd.Context(), f.Streams(), opts, compileDeploymentManifest)
		},
	}
	cmd.Flags().StringVar(&opts.projectID, "project-id", "", "Stable logical project identity (required)")
	cmd.Flags().StringVar(&opts.root, "root", ".", "Project root (default current directory)")
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Optional absolute or root-relative Crux config path")
	cmd.Flags().StringVar(&opts.out, "out", "", "Artifact path (default <root>/.crux/project-index.manifest.json)")
	cmd.Flags().BoolVar(&opts.json, "json", false, "Output one deterministic JSON v1 summary")
	return cmd
}

func runManifest(ctx context.Context, io *output.IO, opts manifestOptions, compile manifestCompileFunc) error {
	if opts.projectID == "" {
		fmt.Fprintln(io.Err, "crux manifest: --project-id is required")
		return domain.ExitError{Code: 2}
	}
	artifact, err := compile(ctx, opts)
	if err != nil {
		fmt.Fprintf(io.Err, "crux manifest: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	manifest, err := projectindex.ParseDeploymentManifest(artifact)
	if err == nil {
		err = projectindex.VerifyDeploymentManifest(manifest)
	}
	if err != nil {
		fmt.Fprintf(io.Err, "crux manifest: invalid compiler artifact: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	if manifest.ProjectID != opts.projectID {
		fmt.Fprintf(io.Err, "crux manifest: compiler artifact project %q does not match %q\n", manifest.ProjectID, opts.projectID)
		return domain.ExitError{Code: 2}
	}

	outPath, err := manifestOutputPath(opts)
	if err != nil {
		fmt.Fprintf(io.Err, "crux manifest: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	if err := writeFileAtomically(outPath, artifact); err != nil {
		fmt.Fprintf(io.Err, "crux manifest: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	summary := manifestJSONSummaryV1{
		SchemaVersion:  1,
		ProjectID:      manifest.ProjectID,
		ManifestID:     manifest.ManifestID,
		Definitions:    len(manifest.Content.Definitions),
		Relations:      len(manifest.Content.Relations),
		SemanticStatus: manifest.Provenance.SemanticStatus,
		Output:         outPath,
	}
	if opts.json {
		if err := io.WriteJSON(summary); err != nil {
			return domain.ExitError{Code: 2}
		}
		return nil
	}
	printManifestSummary(io, summary)
	return nil
}

func compileDeploymentManifest(ctx context.Context, opts manifestOptions) (artifact []byte, err error) {
	indexer := assets.NewEmbeddedProjectIndexer("")
	defer func() {
		if closeErr := indexer.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close Project Index workers: %w", closeErr)
		}
	}()
	result, err := oneshot.New(indexer, nil).Run(ctx, oneshot.Options{
		Root: opts.root, ConfigPath: opts.configPath, ProjectID: opts.projectID,
	})
	if err != nil {
		return nil, err
	}
	root := opts.root
	if result.Index.Project != nil && result.Index.Project.Root != "" {
		root = result.Index.Project.Root
	}
	return indexer.CreateDeploymentManifest(ctx, projectindex.DeploymentManifestProjectionInput{
		Root: root, ProjectID: opts.projectID,
		Definitions: result.Index.Definitions, Relations: result.Index.Relations,
		StaticFrontend: "oxc", SemanticStatus: manifestSemanticStatus(result.Execution),
	})
}

func manifestSemanticStatus(execution oneshot.Execution) string {
	if execution.Semantic == "disabled" {
		return "disabled"
	}
	if execution.Status == "partial" || execution.Semantic != "ready" {
		return "partial"
	}
	return "complete"
}

func manifestOutputPath(opts manifestOptions) (string, error) {
	path := opts.out
	if path == "" {
		path = filepath.Join(opts.root, ".crux", "project-index.manifest.json")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve manifest output path: %w", err)
	}
	return filepath.Clean(absolute), nil
}

func printManifestSummary(io *output.IO, summary manifestJSONSummaryV1) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "manifest"))
	fmt.Fprintf(io.Out, "  Project: %s\n", summary.ProjectID)
	fmt.Fprintf(io.Out, "  Manifest: %s\n", summary.ManifestID)
	fmt.Fprintf(io.Out, "  Catalog: %d definitions, %d relations\n", summary.Definitions, summary.Relations)
	fmt.Fprintf(io.Out, "  Semantic: %s\n", summary.SemanticStatus)
	fmt.Fprintf(io.Out, "  Output: %s\n", summary.Output)
}
