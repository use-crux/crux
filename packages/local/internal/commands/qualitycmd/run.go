package qualitycmd

// The `crux quality run|watch|list|show|progress|cell-evidence|promote`
// command group (spec 03).
// The Go side orchestrates and renders; the embedded Node worker
// (quality-runner.mjs) does the importing and executing. One NDJSON stream
// (domain.QualityEvent), exit codes 0/1/2 (binding).

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

type qualityRunOpts struct {
	configPath     string
	cwd            string
	ids            []string
	cases          []string
	failed         string
	sample         int
	seed           string
	maxCost        float64
	changedSince   string
	variants       []string
	trials         int
	replay         string
	rescore        bool
	experiment     string
	jsonStdout     bool
	jsonOut        string
	junitOut       string
	ci             bool
	maxConcurrency int
	quiet          bool
	verbose        bool
}

func registerQualityRunFlags(cmd *cobra.Command, opts *qualityRunOpts) {
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Path to an optional crux.config.ts policy file")
	cmd.Flags().StringVar(&opts.cwd, "cwd", "", "Working directory for project discovery (default: auto-detect)")
	cmd.Flags().StringArrayVar(&opts.cases, "case", nil, "Filter cases by id/name (glob *), repeatable — demotes gates to informational")
	cmd.Flags().StringVar(&opts.failed, "failed", "", "Rerun failed cells from an experiment id, or latest")
	cmd.Flags().IntVar(&opts.sample, "sample", 0, "Deterministically sample N cases after filters; requires --seed")
	cmd.Flags().StringVar(&opts.seed, "seed", "", "Seed for --sample")
	cmd.Flags().Float64Var(&opts.maxCost, "max-cost", 0, "Stop scheduling new cells after this many USD")
	cmd.Flags().StringVar(&opts.changedSince, "changed-since", "", "Run evaluations affected by files changed since a git ref")
	cmd.Flags().StringArrayVar(&opts.variants, "variant", nil, "Run a variant subset, repeatable")
	cmd.Flags().IntVar(&opts.trials, "trials", 0, "Override trials for this run")
	cmd.Flags().StringVar(&opts.replay, "replay", "", "Replay mode: live | record-new | replay-strict | refresh")
	cmd.Flags().BoolVar(&opts.rescore, "rescore", false, "Reuse cached outputs, re-run scorers/expects only")
	cmd.Flags().StringVar(&opts.experiment, "experiment", "", "Grouping label stored on the record(s)")
	cmd.Flags().BoolVar(&opts.jsonStdout, "json", false, "Write one machine-readable run summary object to stdout")
	cmd.Flags().StringVar(&opts.jsonOut, "json-out", "", "Write one machine-readable run summary object to a path")
	cmd.Flags().StringVar(&opts.junitOut, "junit", "", "Write JUnit XML to a path")
	cmd.Flags().BoolVar(&opts.ci, "ci", false, "Force plain, non-animated output and no color, even on a TTY")
	cmd.Flags().IntVar(&opts.maxConcurrency, "max-concurrency", 0, "Cap parallel cells across all evaluations")
	cmd.Flags().BoolVar(&opts.quiet, "quiet", false, "Failures and summary only")
	cmd.Flags().BoolVar(&opts.verbose, "verbose", false, "Per-cell progress lines")
}

// NewQualityRunCmd creates `crux quality run`.
func NewQualityRunCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityRunOpts{}
	cmd := &cobra.Command{
		Use:   "run [id...]",
		Short: "Run source-defined evaluations and write experiment records",
		Example: `  crux quality run
  crux quality run memory.contracts
  crux quality run memory.contracts --case "*ids*" --variant default
  crux quality run --json-out results.json`,
		Args: cobra.ArbitraryArgs,
		// Run outcomes land in the exit code; usage spam on a failed run
		// would bury the reporter output.
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.ids = args
			return runQualityRun(f, opts)
		},
	}
	registerQualityRunFlags(cmd, opts)
	return cmd
}

// NewQualityListCmd creates `crux quality list` — discovered evaluations, no execution.
func NewQualityListCmd() *cobra.Command {
	var configPath, cwd string
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List discovered source-defined evaluations",
		Example: `  crux quality list
  crux quality list --json`,
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityList(configPath, cwd, jsonOut)
		},
	}
	cmd.Flags().StringVar(&configPath, "config", "", "Path to an optional crux.config.ts policy file")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Working directory for project discovery")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output manifests as JSON")
	return cmd
}

// NewQualityShowCmd creates `crux quality show <experimentId>`.
func NewQualityShowCmd(f *cli.Factory) *cobra.Command {
	var dir string
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "show <experimentId>",
		Short: "Print one saved experiment record",
		Example: `  crux quality show exp_91c2
  crux quality show exp_91c2 --json`,
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityShow(f, args[0], dir, jsonOut)
		},
	}
	cmd.Flags().StringVar(&dir, "dir", "", "Quality persistence root (default: <project root>/.crux/quality)")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Print the raw record JSON")
	return cmd
}

// NewQualityWatchCmd creates `crux quality watch` — incremental re-run on change.
func NewQualityWatchCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityRunOpts{}
	cmd := &cobra.Command{
		Use:   "watch [id...]",
		Short: "Re-run source-defined evaluations when files change",
		Example: `  crux quality watch
  crux quality watch memory.contracts`,
		Args:          cobra.ArbitraryArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.ids = args
			return runQualityWatch(f, opts)
		},
	}
	registerQualityRunFlags(cmd, opts)
	return cmd
}

// NewQualityPromoteCmd creates `crux quality promote <experimentId>`: write
// the committed BaselineRecord for an experiment (spec 02 §3, spec 03 §1).
func NewQualityPromoteCmd(f *cli.Factory) *cobra.Command {
	var configPath, cwd, variant, pinID string
	cmd := &cobra.Command{
		Use:   "promote <experimentId>",
		Short: "Promote an experiment as the committed baseline",
		Example: `  crux quality promote exp_91c2
  crux quality promote exp_91c2 --variant default`,
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityPromote(f, args[0], configPath, cwd, variant, pinID)
		},
	}
	cmd.Flags().StringVar(&configPath, "config", "", "Path to an optional crux.config.ts policy file")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Working directory for project discovery")
	cmd.Flags().StringVar(&variant, "variant", "", "Variant to promote (default: the declared baseline variant)")
	cmd.Flags().StringVar(&pinID, "pin-id", "", "Explicit id to pin for a path-derived evaluation")
	return cmd
}

// runQualityPromote drives the worker's --promote mode and renders the result.
func runQualityPromote(f *cli.Factory, experimentID, configPath, cwd, variant, pinID string) error {
	opts := &qualityRunOpts{configPath: configPath, cwd: cwd}
	extraArgs := []string{"--promote", experimentID}
	if variant != "" {
		extraArgs = append(extraArgs, "--variant", variant)
	}
	if pinID != "" {
		extraArgs = append(extraArgs, "--pin-id", pinID)
	}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, extraArgs, "")
	if err != nil {
		return err
	}
	go filterStderr(stderr)

	forwarder := newRunEventForwarder()
	defer forwarder.close()

	reporter := newQualityReporter(opts, f.Streams(), f.Port)
	result := consumeQualityRunnerStream(stdout, cmd.Wait, reporter, forwarder)
	exitCode := result.exitCode
	if exitCode != 0 {
		return domain.ExitError{Code: exitCode}
	}
	return nil
}

// --- run ---

func runQualityRun(f *cli.Factory, opts *qualityRunOpts) error {
	if err := validateQualityRunOpts(opts); err != nil {
		return err
	}
	exitCode, err := streamQualityRun(f, opts)
	if err != nil {
		return err
	}
	if exitCode != 0 {
		return domain.ExitError{Code: exitCode}
	}
	return nil
}

// streamQualityRun spawns the worker once and renders its stream.
// Returns the run's exit code (0/1/2).
func streamQualityRun(f *cli.Factory, opts *qualityRunOpts) (int, error) {
	io := f.Streams()

	// Mirror the stream to a running devtools server (nil when none is up):
	// devtools renders live per-cell progress via `quality:run:event`.
	forwarder := newRunEventForwarder()
	defer forwarder.close()

	cmd, stdout, stderr, err := spawnQualityRunner(opts, nil, forwarder.devtoolsURL())
	if err != nil {
		return 2, err
	}
	go filterStderr(stderr)

	reporter := newQualityReporter(opts, io, f.Port)
	result := consumeQualityRunnerStream(stdout, cmd.Wait, reporter, forwarder)
	exitCode := result.exitCode

	summary := buildQualityRunSummary(reporter, exitCode, result.err)
	if !opts.jsonStdout {
		reporter.banner(exitCode)
	}

	if opts.junitOut != "" {
		if err := writeQualityJUnit(opts.junitOut, reporter); err != nil {
			fmt.Fprintf(io.Err, "warning: failed to write JUnit output: %v\n", err)
		}
	}
	if opts.jsonStdout {
		if err := writeQualityRunSummaryToWriter(io.Out, summary); err != nil {
			fmt.Fprintf(io.Err, "warning: failed to write JSON output: %v\n", err)
		}
	}
	if opts.jsonOut != "" {
		if err := writeQualityRunSummaryToFile(opts.jsonOut, summary); err != nil {
			fmt.Fprintf(io.Err, "warning: failed to write JSON output: %v\n", err)
		}
	}
	return exitCode, nil
}

func validateQualityRunOpts(opts *qualityRunOpts) error {
	if opts.sample > 0 && opts.seed == "" {
		return fmt.Errorf("--sample requires --seed so sampled runs are reproducible")
	}
	return nil
}

func runQualityList(configPath, cwd string, jsonOut bool) error {
	opts := &qualityRunOpts{configPath: configPath, cwd: cwd}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, []string{"--collect-only"}, "")
	if err != nil {
		return err
	}
	go filterStderr(stderr)

	result := consumeQualityCollectStream(stdout, cmd.Wait)
	manifests := result.manifests
	collectErrors := result.collectErrors
	if result.err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %s\n", result.err.Message)
		return domain.ExitError{Code: result.exitCode}
	}

	if jsonOut {
		data, err := json.MarshalIndent(manifests, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
	} else {
		renderQualityList(os.Stdout, manifests)
	}
	for _, collectErr := range collectErrors {
		fmt.Fprintf(os.Stderr, "ERROR: %s\n", collectErr.Message)
	}
	if len(collectErrors) > 0 || result.exitCode != 0 {
		if result.exitCode == 0 {
			result.exitCode = 2
		}
		return domain.ExitError{Code: result.exitCode}
	}
	return nil
}

func renderQualityList(out io.Writer, manifests []domain.QualityManifest) {
	if len(manifests) == 0 {
		fmt.Fprintln(out, "No evaluations discovered.")
		return
	}
	for _, manifest := range manifests {
		location := manifest.File
		if manifest.Source == "prompt-tests" {
			location = "(colocated prompt tests)"
		}
		fmt.Fprintf(out, "  %-44s %2d cases  %-9s %s\n", manifest.ID, len(manifest.Cases), manifest.Task.Kind, location)
	}
}

func runQualityShow(f *cli.Factory, experimentID, dir string, jsonOut bool) error {
	if dir == "" {
		dir = filepath.Join(projectroot.Dir(), ".crux", "quality")
	}
	path := filepath.Join(dir, "experiments", experimentID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("experiment %s not found under %s: %w", experimentID, dir, err)
	}
	if jsonOut {
		fmt.Println(strings.TrimSpace(string(data)))
		return nil
	}
	var record struct {
		EvaluationID string                    `json:"evaluationId"`
		QualityID    string                    `json:"qualityId"`
		StartedAt    string                    `json:"startedAt"`
		FilteredRun  bool                      `json:"filteredRun"`
		Cells        []domain.QualityCell      `json:"cells"`
		Aggregates   domain.QualityAggregates  `json:"aggregates"`
		Gates        domain.QualityGates       `json:"gates"`
		Passed       bool                      `json:"passed"`
		Comparison   *domain.QualityComparison `json:"comparison"`
	}
	if err := json.Unmarshal(data, &record); err != nil {
		return fmt.Errorf("failed to parse experiment record: %w", err)
	}

	// Reuse the run renderer so a saved record reads identically to a live run
	// (colored rows, gates, failure blocks), with its own identity line.
	io := f.Streams()
	renderer := newQualityRenderer(io, f.Port)
	state := &qualityEvalState{
		evaluationID: record.EvaluationID,
		cells:        record.Cells,
		aggregates:   &record.Aggregates,
		gates:        &record.Gates,
		filteredRun:  record.FilteredRun,
		comparison:   record.Comparison,
	}
	fmt.Fprintf(io.Out, "%s  %s\n", io.Sprint(output.Bold, experimentID),
		io.Sprint(output.Dim, fmt.Sprintf("(%s, started %s)", record.EvaluationID, record.StartedAt)))
	for _, name := range sortedVariantNames(state.aggregates.PerVariant) {
		renderer.variantRow(state, name)
	}
	renderer.comparisonNotes(state.comparison)
	renderer.gates(state.gates, state.filteredRun)
	for i := range state.cells {
		renderer.cellFailure(&state.cells[i], "  ")
	}
	return nil
}

// --- watch (D5: respawn loop; the worker's output cache keeps reruns cheap) ---

func runQualityWatch(f *cli.Factory, opts *qualityRunOpts) error {
	if err := validateQualityRunOpts(opts); err != nil {
		return err
	}
	io := f.Streams()
	configDir := opts.cwd
	if configDir == "" {
		configDir = projectroot.Dir()
	}
	if configDir == "" {
		return fmt.Errorf("no project root found — pass --cwd to choose one")
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer watcher.Close()
	if err := addWatchDirs(watcher, configDir); err != nil {
		return err
	}

	fmt.Fprintf(io.Err, "watching %s — Ctrl-C to stop\n", configDir)
	// Watch always re-scores from the output cache: the cell cache key
	// (taskFingerprint, paramsHash, caseId, …) busts itself when the task,
	// params, or case data change, so unchanged cells skip execution and
	// scorer/expect edits re-score token-free (spec 03 §5).
	opts.rescore = true
	for {
		if _, err := streamQualityRun(f, opts); err != nil {
			fmt.Fprintf(io.Err, "run failed: %v\n", err)
		}
		if !awaitChange(watcher) {
			return nil
		}
		fmt.Fprintln(io.Err, "\nchange detected — re-running")
	}
}

var watchIgnoreDirs = map[string]bool{
	"node_modules": true, ".git": true, ".crux": true, "dist": true, ".next": true, ".turbo": true,
}

func addWatchDirs(watcher *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || !entry.IsDir() {
			return nil
		}
		if watchIgnoreDirs[entry.Name()] {
			return filepath.SkipDir
		}
		return watcher.Add(path)
	})
}

// awaitChange blocks until a relevant file change (debounced) or watcher
// shutdown; returns false when watching should stop.
func awaitChange(watcher *fsnotify.Watcher) bool {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return false
			}
			if !isRelevantWatchEvent(event) {
				continue
			}
			// Debounce a burst of writes.
			deadline := time.After(300 * time.Millisecond)
			for {
				select {
				case <-watcher.Events:
				case <-deadline:
					return true
				}
			}
		case _, ok := <-watcher.Errors:
			if !ok {
				return false
			}
		}
	}
}

func isRelevantWatchEvent(event fsnotify.Event) bool {
	if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
		return false
	}
	name := filepath.Base(event.Name)
	for part := range watchIgnoreDirs {
		if strings.Contains(event.Name, string(filepath.Separator)+part+string(filepath.Separator)) {
			return false
		}
	}
	switch filepath.Ext(name) {
	case ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".json", ".jsonl":
		return true
	}
	return false
}

// --- worker spawn ---

func spawnQualityRunner(opts *qualityRunOpts, extraArgs []string, devtoolsURL string) (*exec.Cmd, io.Reader, io.Reader, error) {
	nodePath, err := assets.FindNode()
	if err != nil {
		return nil, nil, nil, err
	}
	runnerPath, err := assets.ExtractEmbeddedQualityRunner()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to extract embedded quality runner: %w", err)
	}

	args := []string{"--import", "tsx/esm", runnerPath}
	args = append(args, opts.ids...)
	if opts.configPath != "" {
		args = append(args, "--config", opts.configPath)
	}
	for _, pattern := range opts.cases {
		args = append(args, "--case", pattern)
	}
	if opts.failed != "" {
		args = append(args, "--failed", opts.failed)
	}
	if opts.sample > 0 {
		args = append(args, "--sample", fmt.Sprint(opts.sample))
	}
	if opts.seed != "" {
		args = append(args, "--seed", opts.seed)
	}
	if opts.maxCost > 0 {
		args = append(args, "--max-cost", fmt.Sprint(opts.maxCost))
	}
	if opts.changedSince != "" {
		args = append(args, "--changed-since", opts.changedSince)
	}
	for _, variant := range opts.variants {
		args = append(args, "--variant", variant)
	}
	if opts.trials > 0 {
		args = append(args, "--trials", fmt.Sprint(opts.trials))
	}
	if opts.replay != "" {
		args = append(args, "--replay", opts.replay)
	}
	if opts.rescore {
		args = append(args, "--rescore")
	}
	if opts.experiment != "" {
		args = append(args, "--experiment", opts.experiment)
	}
	if opts.maxConcurrency > 0 {
		args = append(args, "--max-concurrency", fmt.Sprint(opts.maxConcurrency))
	}
	args = append(args, extraArgs...)

	cmd := exec.Command(nodePath, args...)
	cmd.Env = withQualityRunnerDevtoolsEnv(os.Environ(), devtoolsURL)
	dir := opts.cwd
	if dir == "" {
		dir = projectroot.Dir()
	}
	if dir != "" {
		cmd.Dir = dir
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, nil, fmt.Errorf("failed to start quality runner: %w", err)
	}
	return cmd, stdout, stderr, nil
}

// filterStderr forwards only meaningful lines from the worker process stderr.
func filterStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		// Skip Node.js runtime noise.
		if strings.Contains(line, "ExperimentalWarning") ||
			strings.Contains(line, "DeprecationWarning") ||
			strings.Contains(line, "punycode") ||
			line == "" {
			continue
		}
		// Forward actual errors and devtools messages.
		fmt.Fprintln(os.Stderr, line)
	}
}
