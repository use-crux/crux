package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/manifeststore"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

const maxManifestImportBytes = 128 * 1024 * 1024

type catalogImportSummaryV1 struct {
	SchemaVersion int    `json:"schemaVersion"`
	Status        string `json:"status"`
	ProjectID     string `json:"projectId"`
	ManifestID    string `json:"manifestId"`
	Definitions   int    `json:"definitions"`
	Relations     int    `json:"relations"`
}

// NewCatalogCmd creates the Project Index catalog command group.
func NewCatalogCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var kind string
	catalog := &cobra.Command{
		Use:   "catalog [flags]",
		Short: "Inspect and import Project Index catalog data",
		Example: `  crux catalog
  crux catalog list --kind agent
  crux catalog show agent:writer
  crux catalog status --json
  crux catalog explain agent:writer
  crux catalog import .crux/project-index.manifest.json`,
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCatalogList(cmd.Context(), f, kind, jsonOutput)
		},
	}
	catalog.Flags().StringVar(&kind, "kind", "", "Filter definitions by exact kind")
	catalog.PersistentFlags().BoolVar(&jsonOutput, "json", false, "Output deterministic JSON")
	catalog.AddCommand(
		newCatalogListCmd(f, &jsonOutput),
		newCatalogShowCmd(f, &jsonOutput),
		newCatalogStatusCmd(f, &jsonOutput),
		newCatalogExplainCmd(f, &jsonOutput),
	)
	importCmd := &cobra.Command{
		Use:   "import <manifest-path>",
		Short: "Verify and import an immutable deployment manifest",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			store := manifeststore.New(projectroot.Dir())
			return runCatalogImport(cmd.Context(), f.Streams(), store, args[0], jsonOutput)
		},
	}
	catalog.AddCommand(importCmd)
	return catalog
}

func runCatalogImport(ctx context.Context, ioStreams *output.IO, store *manifeststore.Store, path string, jsonOutput bool) error {
	artifact, err := readBoundedManifest(path)
	if err != nil {
		fmt.Fprintf(ioStreams.Err, "crux catalog import: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	result, err := store.Import(ctx, artifact)
	if err != nil {
		fmt.Fprintf(ioStreams.Err, "crux catalog import: %v\n", err)
		return domain.ExitError{Code: 2}
	}
	summary := catalogImportSummaryV1{
		SchemaVersion: 1, Status: result.Status,
		ProjectID: result.Manifest.ProjectID, ManifestID: result.Manifest.ManifestID,
		Definitions: len(result.Manifest.Content.Definitions),
		Relations:   len(result.Manifest.Content.Relations),
	}
	if jsonOutput {
		encoder := json.NewEncoder(ioStreams.Out)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(summary); err != nil {
			return domain.ExitError{Code: 2}
		}
		return nil
	}
	fmt.Fprintf(ioStreams.Out, "%s\n\n", brandedHeader(ioStreams, "catalog import"))
	fmt.Fprintf(ioStreams.Out, "  Status: %s\n", summary.Status)
	fmt.Fprintf(ioStreams.Out, "  Project: %s\n", summary.ProjectID)
	fmt.Fprintf(ioStreams.Out, "  Manifest: %s\n", summary.ManifestID)
	fmt.Fprintf(ioStreams.Out, "  Catalog: %d definitions, %d relations\n", summary.Definitions, summary.Relations)
	return nil
}

func readBoundedManifest(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open manifest %q: %w", path, err)
	}
	defer file.Close()
	artifact, err := io.ReadAll(io.LimitReader(file, maxManifestImportBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read manifest %q: %w", path, err)
	}
	if len(artifact) > maxManifestImportBytes {
		return nil, fmt.Errorf("manifest %q exceeds %d bytes", path, maxManifestImportBytes)
	}
	return artifact, nil
}
