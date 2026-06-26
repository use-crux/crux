package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/commandui"
	"github.com/use-crux/crux/packages/local/internal/output"
)

type configInspectOptions struct {
	jsonOutput bool
	cwd        string
	configPath string
	project    string
}

type projectConfigResolveFunc func(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error)

var resolveProjectConfigForInspect projectConfigResolveFunc = inspectProjectConfigWithWorker

const configInspectTimeout = 120 * time.Second

// configSpinnerInterval paces the loader frames during the (potentially
// multi-second) worker resolution so the command never looks hung (clig.dev R3).
const configSpinnerInterval = 80 * time.Millisecond

// NewConfigCmd creates the "crux config" command group for inspecting local
// configuration and source-discovery state.
func NewConfigCmd(f *cli.Factory) *cobra.Command {
	opts := &configInspectOptions{}
	cmd := &cobra.Command{
		Use:     "config",
		Short:   "Inspect resolved Crux configuration and discovery state",
		Example: "  crux config inspect",
	}

	inspectCmd := &cobra.Command{
		Use:   "inspect",
		Short: "Render the effective Crux configuration",
		Long: `Render the effective Crux configuration: every domain config() accepts
(quality, generation, indexer, experimental, observability, devtools, persistence, lint,
plugins) with its resolved value and where that value came from — an explicit
config value, a built-in default, or package metadata.

The project's crux.config.ts is imported in inert CRUX_INDEX=1 mode (no runtime
side effects) so explicit overrides are reflected, not just defaults.`,
		Example: `  crux config inspect
  crux config inspect --cwd packages/backend
  crux config inspect --config crux.config.ts
  crux config inspect --json`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Resolution spawns a Node worker whose lifecycle logs (slog "node
			// worker started"/"stopping…") are internal noise for a one-shot
			// command. Silence them so the rendered config is the only output;
			// CRUX_STARTUP_DEBUG=1 keeps them for troubleshooting.
			if !startupDebugEnabled(false) {
				slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
			}

			root, err := resolveConfigInspectRoot(opts.cwd)
			if err != nil {
				return err
			}

			io := f.Streams()
			config, err := resolveProjectConfigWithProgress(cmd.Context(), io, root, opts.configPath, opts.project)
			if err != nil {
				return err
			}
			if opts.jsonOutput {
				return writePrettyJSON(cmd.OutOrStdout(), config)
			}
			return printConfigInspect(io, config)
		},
	}
	inspectCmd.Flags().BoolVar(&opts.jsonOutput, "json", false, "Output the full effective configuration as JSON")
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

// resolveProjectConfigWithProgress runs the (blocking) worker resolution behind
// an animated status line on an interactive stderr, and silently otherwise. The
// spinner is torn down before any durable output is printed, so a pipe or CI log
// never accumulates carriage returns.
func resolveProjectConfigWithProgress(
	ctx context.Context,
	io *output.IO,
	root, configPath, projectName string,
) (json.RawMessage, error) {
	line := io.NewStatusLine()
	if !line.Active() {
		return resolveProjectConfigForInspect(ctx, root, configPath, projectName)
	}

	frames := []rune(commandui.SpinnerFrames)
	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(configSpinnerInterval)
		defer ticker.Stop()
		for i := 0; ; i++ {
			line.Set(io.Sprint(output.Accent, string(frames[i%len(frames)])) +
				" " + io.Sprint(output.Dim, "Resolving configuration…"))
			select {
			case <-done:
				return
			case <-ticker.C:
			}
		}
	}()

	config, err := resolveProjectConfigForInspect(ctx, root, configPath, projectName)
	close(done)
	<-stopped
	line.Clear()
	return config, err
}

func inspectProjectConfigWithWorker(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (json.RawMessage, error) {
	worker := assets.NewEmbeddedProjectIndexer("")
	defer worker.Close()

	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, configInspectTimeout)
		defer cancel()
	}
	return worker.InspectProjectConfig(ctx, root, configPath, projectName)
}

func writePrettyJSON(out io.Writer, raw json.RawMessage) error {
	if !json.Valid(raw) {
		return fmt.Errorf("config inspect resolver returned invalid JSON")
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	_, err := out.Write(buf.Bytes())
	return err
}

// ── Decoded effective-config shape (mirrors @use-crux/indexer ProjectConfigInspect) ──

type configInspect struct {
	Root          string                     `json:"root"`
	PackageName   string                     `json:"packageName,omitempty"`
	ConfigFile    configFileInspect          `json:"configFile"`
	Quality       configQualityInspect       `json:"quality"`
	Generation    configGenerationInspect    `json:"generation"`
	Indexer       configIndexerInspect       `json:"indexer"`
	Experimental  configExperimentalInspect  `json:"experimental"`
	Observability configObservabilityInspect `json:"observability"`
	Devtools      configDevtoolsInspect      `json:"devtools"`
	Persistence   configPersistenceInspect   `json:"persistence"`
	Lint          configLintInspect          `json:"lint"`
	Plugins       configList                 `json:"plugins"`
	Discovered    configDiscovered           `json:"discovered"`
	Diagnostics   []configDiagnostic         `json:"diagnostics"`
}

type configSetting struct {
	Value  string `json:"value"`
	Origin string `json:"origin"`
}

type configList struct {
	Values []string `json:"values"`
	Origin string   `json:"origin"`
}

type configFileInspect struct {
	Path   string `json:"path,omitempty"`
	Status string `json:"status"`
	Origin string `json:"origin"`
	Error  string `json:"error,omitempty"`
}

type configQualityInspect struct {
	ID          configSetting `json:"id"`
	Dir         configSetting `json:"dir"`
	Include     configList    `json:"include"`
	Exclude     configList    `json:"exclude"`
	Redact      configList    `json:"redact"`
	Trials      configSetting `json:"trials"`
	Concurrency configSetting `json:"concurrency"`
	TimeoutMs   configSetting `json:"timeoutMs"`
	Replay      configSetting `json:"replay"`
}

type configGenerationInspect struct {
	AutoEscape       configSetting `json:"autoEscape"`
	SecurityWarnings configSetting `json:"securityWarnings"`
	Tokenizer        configSetting `json:"tokenizer"`
	Middleware       configSetting `json:"middleware"`
}

type configIndexerInspect struct {
	Trust      configSetting `json:"trust"`
	Extensions configList    `json:"extensions"`
}

type configExperimentalInspect struct {
	Indexer configExperimentalIndexerInspect `json:"indexer"`
}

type configExperimentalIndexerInspect struct {
	Native       configSetting `json:"native"`
	NativeAst    configSetting `json:"nativeAst"`
	NativeEngine configSetting `json:"nativeEngine"`
	TSServerPath configSetting `json:"tsserverPath"`
}

type configObservabilityInspect struct {
	Enabled   configSetting `json:"enabled"`
	ServerURL configSetting `json:"serverUrl"`
	Transport configSetting `json:"transport"`
}

type configDevtoolsInspect struct {
	ServerURL configSetting `json:"serverUrl"`
	Bridge    configSetting `json:"bridge"`
}

type configPersistenceInspect struct {
	Store configSetting `json:"store"`
}

type configLintInspect struct {
	Profile configSetting `json:"profile"`
	Rules   configSetting `json:"rules"`
}

type configDiscovered struct {
	Definitions     int            `json:"definitions"`
	Relations       int            `json:"relations"`
	Evaluations     int            `json:"evaluations"`
	DefinitionKinds map[string]int `json:"definitionKinds"`
}

type configDiagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// configRow is one rendered "label  value  (origin)" line, plus any continuation
// values for a list. Values are pre-styled; the renderer owns label alignment.
type configRow struct {
	label     string
	value     string
	tag       string
	subValues []string
}

// printConfigInspect renders the effective Crux configuration: project identity,
// the resolved config file, and every config() domain with its values and origin
// tags — `(default)`, `(config)`, `(package.json)`, `(set)` — so a zero-config
// project reads as the defaults Crux applied and an overridden one shows exactly
// what changed. A compact discovery summary and diagnostics close it out. Paths
// are normalized relative to the project root; every styled span funnels through
// io.Sprint so `--no-color`/non-TTY output stays byte-clean.
func printConfigInspect(io *output.IO, raw json.RawMessage) error {
	var model configInspect
	if err := json.Unmarshal(raw, &model); err != nil {
		return fmt.Errorf("decode effective config: %w", err)
	}

	root := model.Root
	out := io.Out
	fmt.Fprintf(out, "%s\n\n", brandedHeader(io, "config inspect"))

	// ── Project ──────────────────────────────────────────────
	printConfigDomain(io, "Project", []configRow{
		{label: "root", value: io.Sprint(output.Cyan, displayRoot(root))},
		packageRow(io, model.PackageName),
	})

	// ── Config file ──────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigFile(io, model.ConfigFile, root)

	// ── quality: ─────────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "quality:", []configRow{
		settingRow(io, "id", model.Quality.ID),
		pathSettingRow(io, "dir", model.Quality.Dir, root),
		listRow(io, "include", model.Quality.Include),
		listRow(io, "exclude", model.Quality.Exclude),
		listRow(io, "redact", model.Quality.Redact),
		settingRow(io, "trials", model.Quality.Trials),
		settingRow(io, "concurrency", model.Quality.Concurrency),
		settingRow(io, "timeoutMs", model.Quality.TimeoutMs),
		settingRow(io, "replay", model.Quality.Replay),
	})

	// ── generation: ──────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "generation:", []configRow{
		settingRow(io, "autoEscape", model.Generation.AutoEscape),
		settingRow(io, "securityWarnings", model.Generation.SecurityWarnings),
		settingRow(io, "tokenizer", model.Generation.Tokenizer),
		settingRow(io, "middleware", model.Generation.Middleware),
	})

	// ── indexer: ─────────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "indexer:", []configRow{
		settingRow(io, "trust", model.Indexer.Trust),
		listRow(io, "extensions", model.Indexer.Extensions),
	})

	// ── experimental: ────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "experimental:", []configRow{
		settingRow(io, "indexer.native", model.Experimental.Indexer.Native),
		settingRow(io, "indexer.nativeAst", model.Experimental.Indexer.NativeAst),
		settingRow(io, "indexer.nativeEngine", model.Experimental.Indexer.NativeEngine),
		pathSettingRow(io, "indexer.tsserverPath", model.Experimental.Indexer.TSServerPath, root),
	})

	// ── observability: ───────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "observability:", []configRow{
		settingRow(io, "enabled", model.Observability.Enabled),
		settingRow(io, "serverUrl", model.Observability.ServerURL),
		settingRow(io, "transport", model.Observability.Transport),
	})

	// ── devtools: ────────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "devtools:", []configRow{
		settingRow(io, "serverUrl", model.Devtools.ServerURL),
		settingRow(io, "bridge", model.Devtools.Bridge),
	})

	// ── persistence: ─────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "persistence:", []configRow{
		settingRow(io, "store", model.Persistence.Store),
	})

	// ── lint: ────────────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "lint:", []configRow{
		settingRow(io, "profile", model.Lint.Profile),
		settingRow(io, "rules", model.Lint.Rules),
	})

	// ── plugins: ─────────────────────────────────────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "plugins:", []configRow{
		listRow(io, "installed", model.Plugins),
	})

	// ── Discovered (compact context, not config) ─────────────
	fmt.Fprintln(out)
	printConfigDomain(io, "Discovered", []configRow{
		{label: "definitions", value: io.Sprint(output.Bold, fmt.Sprintf("%d", model.Discovered.Definitions))},
		{label: "relations", value: io.Sprint(output.Bold, fmt.Sprintf("%d", model.Discovered.Relations))},
		{label: "evaluations", value: io.Sprint(output.Bold, fmt.Sprintf("%d", model.Discovered.Evaluations))},
	})

	// ── Diagnostics ──────────────────────────────────────────
	fmt.Fprintln(out)
	configCountSection(io, "Diagnostics", len(model.Diagnostics))
	if len(model.Diagnostics) == 0 {
		fmt.Fprintf(out, "    %s %s\n", io.Sprint(output.Green, "✓"), io.Sprint(output.Dim, "none"))
		return nil
	}
	printConfigDiagnostics(io, model.Diagnostics)
	return nil
}

// ── Row builders ──────────────────────────────────────────────────

func packageRow(io *output.IO, name string) configRow {
	if name == "" {
		return configRow{label: "package", value: io.Sprint(output.Dim, "none")}
	}
	return configRow{label: "package", value: io.Sprint(output.Cyan, name), tag: "package.json"}
}

func settingRow(io *output.IO, label string, setting configSetting) configRow {
	return configRow{label: label, value: styleSettingValue(io, setting), tag: configOriginTag(setting.Origin)}
}

// pathSettingRow renders a setting whose value is a path, normalized relative to
// the project root before styling.
func pathSettingRow(io *output.IO, label string, setting configSetting, root string) configRow {
	if setting.Value == "" || setting.Value == "none" {
		return configRow{label: label, value: io.Sprint(output.Dim, "none")}
	}
	return configRow{
		label: label,
		value: io.Sprint(output.Cyan, relativeToRoot(root, setting.Value)),
		tag:   configOriginTag(setting.Origin),
	}
}

func listRow(io *output.IO, label string, list configList) configRow {
	if len(list.Values) == 0 {
		return configRow{label: label, value: io.Sprint(output.Dim, "none")}
	}
	values := make([]string, len(list.Values))
	for i, value := range list.Values {
		values[i] = io.Sprint(output.Cyan, value)
	}
	return configRow{label: label, value: values[0], tag: configOriginTag(list.Origin), subValues: values[1:]}
}

func styleSettingValue(io *output.IO, setting configSetting) string {
	if setting.Origin == "none" || setting.Value == "none" {
		return io.Sprint(output.Dim, "none")
	}
	return io.Sprint(output.Cyan, setting.Value)
}

// configOriginTag maps a resolution origin to its dim "(…)" tag. "none" yields no
// tag because the value already renders as a dim "none".
func configOriginTag(origin string) string {
	switch origin {
	case "default":
		return "default"
	case "config":
		return "config"
	case "package.json":
		return "package.json"
	case "set":
		return "set"
	default: // "none" and any unknown origin render untagged
		return ""
	}
}

// ── Section rendering ─────────────────────────────────────────────

// printConfigDomain renders a bold section title followed by aligned rows. The
// label column auto-sizes to the section's longest label, and list continuation
// values align under the first value.
func printConfigDomain(io *output.IO, title string, rows []configRow) {
	configSection(io, title)
	width := 0
	for _, row := range rows {
		if len(row.label) > width {
			width = len(row.label)
		}
	}
	for _, row := range rows {
		label := row.label + strings.Repeat(" ", width-len(row.label))
		line := "    " + io.Sprint(output.Dim, label) + "  " + row.value
		if row.tag != "" {
			line += "  " + io.Sprint(output.Dim, "("+row.tag+")")
		}
		fmt.Fprintln(io.Out, line)
		pad := strings.Repeat(" ", width)
		for _, sub := range row.subValues {
			fmt.Fprintf(io.Out, "    %s  %s\n", pad, sub)
		}
	}
}

// configSection prints a bold section title indented two columns.
func configSection(io *output.IO, title string) {
	fmt.Fprintf(io.Out, "  %s\n", io.Sprint(output.Bold, title))
}

// configCountSection prints a bold section title followed by a dim item count.
func configCountSection(io *output.IO, title string, count int) {
	fmt.Fprintf(io.Out, "  %s  %s\n", io.Sprint(output.Bold, title), io.Sprint(output.Dim, fmt.Sprintf("%d", count)))
}

// printConfigFile renders the resolved config file: its root-relative path with
// the origin that located it, the resolution status with a colored glyph, and any
// import error. Status drives the glyph: loaded→✓, missing/import-failed→✗,
// unrecognized→●.
func printConfigFile(io *output.IO, file configFileInspect, root string) {
	rows := make([]configRow, 0, 3)
	if file.Path != "" {
		rows = append(rows, configRow{
			label: "file",
			value: io.Sprint(output.Cyan, relativeToRoot(root, file.Path)),
			tag:   configFileOriginTag(file.Origin),
		})
	} else {
		rows = append(rows, configRow{label: "file", value: io.Sprint(output.Dim, "none")})
	}
	glyph, style := configStatusStyle(file.Status)
	rows = append(rows, configRow{label: "status", value: io.Sprint(style, glyph+" "+file.Status)})
	if file.Error != "" {
		rows = append(rows, configRow{label: "error", value: io.Sprint(output.Red, file.Error)})
	}
	printConfigDomain(io, "Config file", rows)
}

func configFileOriginTag(origin string) string {
	switch origin {
	case "--config":
		return "--config"
	case "discovered":
		return "discovered"
	default:
		return ""
	}
}

// configStatusStyle maps a resolved config file status to its glyph and color.
func configStatusStyle(status string) (string, lipgloss.Style) {
	switch status {
	case "loaded":
		return "✓", output.Green
	case "missing", "import-failed":
		return "✗", output.Red
	case "unrecognized", "source-only":
		return "●", output.Yellow
	default:
		return "•", output.Dim
	}
}

// printConfigDiagnostics renders diagnostics sorted by severity (error → warning
// → info), each as a colored glyph + severity label + dim code, with the message
// on a continuation line. Coloring matches the lint renderer.
func printConfigDiagnostics(io *output.IO, diagnostics []configDiagnostic) {
	sorted := make([]configDiagnostic, len(diagnostics))
	copy(sorted, diagnostics)
	sort.SliceStable(sorted, func(i, j int) bool {
		if rankSeverity(sorted[i].Severity) != rankSeverity(sorted[j].Severity) {
			return rankSeverity(sorted[i].Severity) < rankSeverity(sorted[j].Severity)
		}
		return sorted[i].Code < sorted[j].Code
	})
	for _, diagnostic := range sorted {
		style := lintSeverityStyle(diagnostic.Severity)
		fmt.Fprintf(io.Out, "    %s %s  %s\n",
			io.Sprint(style, configDiagnosticGlyph(diagnostic.Severity)),
			io.Sprint(style, diagnostic.Severity),
			io.Sprint(output.Dim, diagnostic.Code),
		)
		if diagnostic.Message != "" {
			fmt.Fprintf(io.Out, "      %s\n", diagnostic.Message)
		}
	}
}

func configDiagnosticGlyph(severity string) string {
	switch severity {
	case "error":
		return "✗"
	case "warning":
		return "▲"
	default:
		return "•"
	}
}

// ── Path normalization ────────────────────────────────────────────

// displayRoot collapses the user's home directory to "~" for the anchor path so
// the root reads cleanly without losing meaning. Paths outside home are returned
// verbatim.
func displayRoot(root string) string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		home = filepath.ToSlash(home)
		slashed := filepath.ToSlash(root)
		if slashed == home {
			return "~"
		}
		if strings.HasPrefix(slashed, home+"/") {
			return "~/" + slashed[len(home)+1:]
		}
	}
	return root
}

// relativeToRoot normalizes a resolver path (POSIX, produced by the Node worker)
// to a project-root-relative form: the root itself becomes ".", descendants drop
// the shared prefix, and anything outside the tree is returned unchanged.
func relativeToRoot(root, p string) string {
	if root == "" || p == "" {
		return p
	}
	root = path.Clean(filepath.ToSlash(root))
	cleaned := path.Clean(filepath.ToSlash(p))
	if cleaned == root {
		return "."
	}
	if strings.HasPrefix(cleaned, root+"/") {
		return cleaned[len(root)+1:]
	}
	return p
}
