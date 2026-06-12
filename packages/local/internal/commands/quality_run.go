package commands

// The `crux quality run|watch|list|show|promote` command group (spec 03).
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
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/server"
)

type qualityRunOpts struct {
	configPath     string
	cwd            string
	ids            []string
	cases          []string
	variants       []string
	trials         int
	replay         string
	rescore        bool
	experiment     string
	jsonOut        string
	junitOut       string
	ci             bool
	maxConcurrency int
	quiet          bool
	verbose        bool
}

func registerQualityRunFlags(cmd *cobra.Command, opts *qualityRunOpts) {
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Path to crux.config.ts")
	cmd.Flags().StringVar(&opts.cwd, "cwd", "", "Working directory for config discovery (default: auto-detect)")
	cmd.Flags().StringArrayVar(&opts.cases, "case", nil, "Filter cases by id/name (glob *), repeatable — demotes gates to informational")
	cmd.Flags().StringArrayVar(&opts.variants, "variant", nil, "Run a variant subset, repeatable")
	cmd.Flags().IntVar(&opts.trials, "trials", 0, "Override trials for this run")
	cmd.Flags().StringVar(&opts.replay, "replay", "", "Replay mode: live | record-new | replay-strict | refresh")
	cmd.Flags().BoolVar(&opts.rescore, "rescore", false, "Reuse cached outputs, re-run scorers/expects only")
	cmd.Flags().StringVar(&opts.experiment, "experiment", "", "Grouping label stored on the record(s)")
	cmd.Flags().StringVar(&opts.jsonOut, "json", "", "Write the Experiment record(s) to stdout (--json) or a path")
	cmd.Flags().Lookup("json").NoOptDefVal = "-"
	cmd.Flags().StringVar(&opts.junitOut, "junit", "", "Write JUnit XML to a path")
	cmd.Flags().BoolVar(&opts.ci, "ci", false, "CI mode: no TTY animation, plain log lines")
	cmd.Flags().IntVar(&opts.maxConcurrency, "max-concurrency", 0, "Cap parallel cells across all evaluations")
	cmd.Flags().BoolVar(&opts.quiet, "quiet", false, "Failures and summary only")
	cmd.Flags().BoolVar(&opts.verbose, "verbose", false, "Per-cell progress lines")
}

// NewQualityRunCmd creates `crux quality run` (also reached via `crux eval`).
func NewQualityRunCmd() *cobra.Command {
	opts := &qualityRunOpts{}
	cmd := &cobra.Command{
		Use:   "run [id...]",
		Short: "Run all discovered evaluations, or the listed ids",
		Args:  cobra.ArbitraryArgs,
		// Run outcomes land in the exit code; usage spam on a failed run
		// would bury the reporter output.
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.ids = args
			return runQualityRun(opts)
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
		Use:           "list",
		Short:         "List discovered evaluations (manifests)",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityList(configPath, cwd, jsonOut)
		},
	}
	cmd.Flags().StringVar(&configPath, "config", "", "Path to crux.config.ts")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Working directory for config discovery")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output manifests as JSON")
	return cmd
}

// NewQualityShowCmd creates `crux quality show <experimentId>`.
func NewQualityShowCmd() *cobra.Command {
	var dir string
	var jsonOut bool
	cmd := &cobra.Command{
		Use:          "show <experimentId>",
		Short:        "Print one experiment record",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityShow(args[0], dir, jsonOut)
		},
	}
	cmd.Flags().StringVar(&dir, "dir", "", "Quality persistence root (default: <config dir>/.crux/quality)")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Print the raw record JSON")
	return cmd
}

// NewQualityWatchCmd creates `crux quality watch` — incremental re-run on change.
func NewQualityWatchCmd() *cobra.Command {
	opts := &qualityRunOpts{}
	cmd := &cobra.Command{
		Use:           "watch [id...]",
		Short:         "Re-run evaluations when files change",
		Args:          cobra.ArbitraryArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.ids = args
			return runQualityWatch(opts)
		},
	}
	registerQualityRunFlags(cmd, opts)
	return cmd
}

// NewQualityPromoteCmd creates `crux quality promote <experimentId>`: write
// the committed BaselineRecord for an experiment (spec 02 §3, spec 03 §1).
func NewQualityPromoteCmd() *cobra.Command {
	var configPath, cwd, variant, pinID string
	cmd := &cobra.Command{
		Use:           "promote <experimentId>",
		Short:         "Promote an experiment to the committed baseline",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityPromote(args[0], configPath, cwd, variant, pinID)
		},
	}
	cmd.Flags().StringVar(&configPath, "config", "", "Path to crux.config.ts")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Working directory for config discovery")
	cmd.Flags().StringVar(&variant, "variant", "", "Variant to promote (default: the declared baseline variant)")
	cmd.Flags().StringVar(&pinID, "pin-id", "", "Explicit id to pin for a path-derived evaluation")
	return cmd
}

// runQualityPromote drives the worker's --promote mode and renders the result.
func runQualityPromote(experimentID, configPath, cwd, variant, pinID string) error {
	opts := &qualityRunOpts{configPath: configPath, cwd: cwd}
	extraArgs := []string{"--promote", experimentID}
	if variant != "" {
		extraArgs = append(extraArgs, "--variant", variant)
	}
	if pinID != "" {
		extraArgs = append(extraArgs, "--pin-id", pinID)
	}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, extraArgs)
	if err != nil {
		return err
	}
	go filterStderr(stderr)

	reporter := newQualityReporter(opts)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	exitCode := 2
	for scanner.Scan() {
		var ev domain.QualityEvent
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}
		reporter.handle(&ev)
		if ev.Type == "run:done" {
			exitCode = ev.ExitCode
		}
	}
	_ = cmd.Wait()
	if exitCode != 0 {
		return domain.ExitError{Code: exitCode}
	}
	return nil
}

// --- run ---

func runQualityRun(opts *qualityRunOpts) error {
	exitCode, err := streamQualityRun(opts)
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
func streamQualityRun(opts *qualityRunOpts) (int, error) {
	cmd, stdout, stderr, err := spawnQualityRunner(opts, nil)
	if err != nil {
		return 2, err
	}
	go filterStderr(stderr)

	reporter := newQualityReporter(opts)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)

	exitCode := 2 // worker dying before run:done is a definition/runner error
	for scanner.Scan() {
		var ev domain.QualityEvent
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}
		reporter.handle(&ev)
		if ev.Type == "run:done" {
			exitCode = ev.ExitCode
		}
	}
	_ = cmd.Wait()

	reporter.summary(exitCode)

	if opts.junitOut != "" {
		if err := writeQualityJUnit(opts.junitOut, reporter); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write JUnit output: %v\n", err)
		}
	}
	if opts.jsonOut != "" {
		if err := writeQualityRecords(opts.jsonOut, reporter.recordPaths); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write JSON output: %v\n", err)
		}
	}
	return exitCode, nil
}

func runQualityList(configPath, cwd string, jsonOut bool) error {
	opts := &qualityRunOpts{configPath: configPath, cwd: cwd}
	cmd, stdout, stderr, err := spawnQualityRunner(opts, []string{"--collect-only"})
	if err != nil {
		return err
	}
	go filterStderr(stderr)

	var manifests []domain.QualityManifest
	var collectErrors []domain.QualityCollectError
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var ev domain.QualityEvent
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}
		if ev.Type == "collect:done" {
			manifests = ev.Evaluations
			collectErrors = ev.Errors
		}
	}
	_ = cmd.Wait()

	if jsonOut {
		data, err := json.MarshalIndent(manifests, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
	} else {
		if len(manifests) == 0 {
			fmt.Println("No evaluations discovered.")
		}
		for _, manifest := range manifests {
			location := manifest.File
			if manifest.Source == "prompt-tests" {
				location = "(colocated prompt tests)"
			}
			fmt.Printf("  %-44s %2d cases  %-9s %s\n", manifest.ID, len(manifest.Cases), manifest.Task.Kind, location)
		}
	}
	for _, collectErr := range collectErrors {
		fmt.Fprintf(os.Stderr, "ERROR: %s\n", collectErr.Message)
	}
	if len(collectErrors) > 0 {
		return domain.ExitError{Code: 2}
	}
	return nil
}

func runQualityShow(experimentID, dir string, jsonOut bool) error {
	if dir == "" {
		configDir := findConfigDir()
		if configDir == "" {
			configDir = "."
		}
		dir = filepath.Join(configDir, ".crux", "quality")
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
		Cases        []domain.QualityCell      `json:"cases"`
		Aggregates   domain.QualityAggregates  `json:"aggregates"`
		Gates        domain.QualityGates       `json:"gates"`
		Passed       bool                      `json:"passed"`
		Comparison   *domain.QualityComparison `json:"comparison"`
	}
	if err := json.Unmarshal(data, &record); err != nil {
		return fmt.Errorf("failed to parse experiment record: %w", err)
	}
	fmt.Printf("%s  (%s, started %s)\n", experimentID, record.EvaluationID, record.StartedAt)
	for name, aggregate := range record.Aggregates.PerVariant {
		fmt.Printf("  %s %-12s %d/%d  pass %.2f%s\n",
			statusGlyph(record.Passed), name, aggregate.Passed, aggregate.Cells-aggregate.Skipped,
			aggregate.PassRate, formatScores(aggregate, variantDeltas(record.Comparison, name)))
	}
	printComparisonNotes(record.Comparison)
	printGates(&record.Gates, record.FilteredRun)
	for i := range record.Cases {
		printCellFailure(&record.Cases[i], "  ")
	}
	return nil
}

// --- watch (D5: respawn loop; the worker's output cache keeps reruns cheap) ---

func runQualityWatch(opts *qualityRunOpts) error {
	configDir := opts.cwd
	if configDir == "" {
		configDir = findConfigDir()
	}
	if configDir == "" {
		return fmt.Errorf("no crux.config.ts found — watch needs a project root")
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer watcher.Close()
	if err := addWatchDirs(watcher, configDir); err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "watching %s — Ctrl-C to stop\n", configDir)
	// Watch always re-scores from the output cache: the cell cache key
	// (taskFingerprint, paramsHash, caseId, …) busts itself when the task,
	// params, or case data change, so unchanged cells skip execution and
	// scorer/expect edits re-score token-free (spec 03 §5).
	opts.rescore = true
	for {
		if _, err := streamQualityRun(opts); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
		}
		if !awaitChange(watcher) {
			return nil
		}
		fmt.Fprintln(os.Stderr, "\nchange detected — re-running")
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

func spawnQualityRunner(opts *qualityRunOpts, extraArgs []string) (*exec.Cmd, io.Reader, io.Reader, error) {
	nodePath, err := server.FindNode()
	if err != nil {
		return nil, nil, nil, err
	}
	runnerPath, err := server.ExtractQualityRunner()
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
	dir := opts.cwd
	if dir == "" {
		dir = findConfigDir()
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
