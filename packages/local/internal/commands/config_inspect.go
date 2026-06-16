package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/server"
)

type configInspectOptions struct {
	jsonOutput bool
	cwd        string
	configPath string
	project    string
}

type projectModelResolveFunc func(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error)

var resolveProjectModelForConfigInspect projectModelResolveFunc = resolveProjectModelWithWorker

const configInspectTimeout = 120 * time.Second

// NewConfigCmd creates the "crux config" command group for inspecting local
// configuration and source-discovery state.
func NewConfigCmd(_ *cli.Factory) *cobra.Command {
	opts := &configInspectOptions{}
	cmd := &cobra.Command{
		Use:     "config",
		Short:   "Inspect resolved Crux configuration and discovery state",
		Example: "  crux config inspect --json",
	}

	inspectCmd := &cobra.Command{
		Use:   "inspect",
		Short: "Render the resolved Project Model",
		Example: `  crux config inspect --json
  crux config inspect --json --cwd packages/backend
  crux config inspect --json --config crux.config.ts`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			root, err := resolveConfigInspectRoot(opts.cwd)
			if err != nil {
				return err
			}
			model, err := resolveProjectModelForConfigInspect(cmd.Context(), root, opts.configPath, opts.project)
			if err != nil {
				return err
			}
			if !opts.jsonOutput {
				return renderProjectModelHuman(cmd.OutOrStdout(), model)
			}
			return writePrettyJSON(cmd.OutOrStdout(), model)
		},
	}
	inspectCmd.Flags().BoolVar(&opts.jsonOutput, "json", false, "Output the full Project Model as JSON")
	inspectCmd.Flags().StringVar(&opts.cwd, "cwd", "", "Project root to inspect (default: nearest config or package root)")
	inspectCmd.Flags().StringVar(&opts.configPath, "config", "", "Crux config path relative to the project root")
	inspectCmd.Flags().StringVar(&opts.project, "name", "", "Project name to include in worker resolution")
	cmd.AddCommand(inspectCmd)
	return cmd
}

func resolveConfigInspectRoot(cwd string) (string, error) {
	if cwd != "" {
		return filepath.Abs(cwd)
	}
	if root := findProjectDir(); root != "" {
		return root, nil
	}
	return os.Getwd()
}

func resolveProjectModelWithWorker(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (json.RawMessage, error) {
	worker := server.NewProjectIndexWorker("")
	defer worker.Close()

	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, configInspectTimeout)
		defer cancel()
	}
	return worker.ResolveProjectModel(ctx, root, configPath, projectName)
}

func writePrettyJSON(out io.Writer, raw json.RawMessage) error {
	if !json.Valid(raw) {
		return fmt.Errorf("project model resolver returned invalid JSON")
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	_, err := out.Write(buf.Bytes())
	return err
}

type projectModelInspect struct {
	Root         projectModelStringField         `json:"root"`
	PackageName  *projectModelStringField        `json:"packageName,omitempty"`
	ConfigFiles  []projectModelConfigFileInspect `json:"configFiles"`
	SourceRoots  []projectModelStringField       `json:"sourceRoots"`
	IgnoredPaths []projectModelStringField       `json:"ignoredPaths"`
	Definitions  []projectModelDefinitionInspect `json:"definitions"`
	Quality      projectModelQualityInspect      `json:"quality"`
	Diagnostics  []projectModelDiagnosticInspect `json:"diagnostics"`
}

type projectModelStringField struct {
	Value string `json:"value"`
}

type projectModelConfigFileInspect struct {
	Path   projectModelStringField `json:"path"`
	Status projectModelStringField `json:"status"`
}

type projectModelDefinitionInspect struct {
	Kind       string                  `json:"kind"`
	Visibility projectModelStringField `json:"visibility"`
}

type projectModelQualityInspect struct {
	ID              *projectModelStringField  `json:"id,omitempty"`
	PersistenceRoot projectModelStringField   `json:"persistenceRoot"`
	IncludeGlobs    []projectModelStringField `json:"includeGlobs"`
	EvaluationFiles []projectModelStringField `json:"evaluationFiles"`
}

type projectModelDiagnosticInspect struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

func renderProjectModelHuman(out io.Writer, raw json.RawMessage) error {
	var model projectModelInspect
	if err := json.Unmarshal(raw, &model); err != nil {
		return fmt.Errorf("decode project model: %w", err)
	}

	fmt.Fprintln(out, "Project Model")
	fmt.Fprintf(out, "root: %s\n", model.Root.Value)
	fmt.Fprintf(out, "package: %s\n", optionalFieldValue(model.PackageName))
	fmt.Fprintf(out, "config: %s\n", configSummary(model.ConfigFiles))
	fmt.Fprintf(out, "source roots: %s\n", joinedFieldValues(model.SourceRoots))
	fmt.Fprintf(out, "ignored paths: %s\n", joinedFieldValues(model.IgnoredPaths))
	fmt.Fprintf(out, "definitions: %s\n", countSummary(definitionKindCounts(model.Definitions)))
	fmt.Fprintf(out, "visibility: %s\n", countSummary(visibilityCounts(model.Definitions)))
	fmt.Fprintf(
		out,
		"quality: id=%s, persistence=%s, includes=%d, eval files=%d\n",
		optionalFieldValue(model.Quality.ID),
		model.Quality.PersistenceRoot.Value,
		len(model.Quality.IncludeGlobs),
		len(model.Quality.EvaluationFiles),
	)
	fmt.Fprintln(out, "diagnostics:")
	if len(model.Diagnostics) == 0 {
		fmt.Fprintln(out, "  none")
		return nil
	}
	for _, diagnostic := range model.Diagnostics {
		fmt.Fprintf(out, "  %s %s - %s\n", diagnostic.Severity, diagnostic.Code, diagnostic.Message)
	}
	return nil
}

func optionalFieldValue(field *projectModelStringField) string {
	if field == nil || field.Value == "" {
		return "(none)"
	}
	return field.Value
}

func configSummary(files []projectModelConfigFileInspect) string {
	if len(files) == 0 {
		return "none"
	}
	values := make([]string, 0, len(files))
	for _, file := range files {
		if file.Path.Value == "" {
			values = append(values, file.Status.Value)
			continue
		}
		values = append(values, fmt.Sprintf("%s (%s)", file.Status.Value, file.Path.Value))
	}
	return strings.Join(values, ", ")
}

func joinedFieldValues(fields []projectModelStringField) string {
	if len(fields) == 0 {
		return "(none)"
	}
	values := make([]string, 0, len(fields))
	for _, field := range fields {
		values = append(values, field.Value)
	}
	return strings.Join(values, ", ")
}

func definitionKindCounts(definitions []projectModelDefinitionInspect) map[string]int {
	counts := make(map[string]int)
	for _, definition := range definitions {
		counts[definition.Kind] += 1
	}
	return counts
}

func visibilityCounts(definitions []projectModelDefinitionInspect) map[string]int {
	counts := make(map[string]int)
	for _, definition := range definitions {
		counts[definition.Visibility.Value] += 1
	}
	return counts
}

func countSummary(counts map[string]int) string {
	if len(counts) == 0 {
		return "(none)"
	}
	keys := make([]string, 0, len(counts))
	for key := range counts {
		if key != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%d", key, counts[key]))
	}
	if len(parts) == 0 {
		return "(none)"
	}
	return strings.Join(parts, ", ")
}
