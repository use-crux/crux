package qualitycmd

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
)

type qualityDiffOpts struct {
	configPath string
	cwd        string
	dir        string
	jsonOut    bool
}

type qualityDiffForwarder interface {
	forward(line []byte)
}

// NewQualityDiffCmd creates `crux quality diff <expA> <expB>`.
func NewQualityDiffCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityDiffOpts{}
	cmd := &cobra.Command{
		Use:          "diff <experiment-a> <experiment-b>",
		Short:        "Compare two saved Quality experiment records",
		Args:         cobra.ExactArgs(2),
		SilenceUsage: true,
		Example:      "  crux quality diff 01KTA 01KTB --json",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityDiff(f, cmd.OutOrStdout(), args[0], args[1], *opts)
		},
	}
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Path to an optional crux.config.ts policy file")
	cmd.Flags().StringVar(&opts.cwd, "cwd", "", "Working directory for project discovery")
	cmd.Flags().StringVar(&opts.dir, "dir", "", "Quality persistence root (default: <project root>/.crux/quality)")
	cmd.Flags().BoolVar(&opts.jsonOut, "json", false, "Print the diff as JSON")
	return cmd
}

func runQualityDiff(f *cli.Factory, out io.Writer, a, b string, opts qualityDiffOpts) error {
	if !opts.jsonOut {
		return fmt.Errorf("quality diff currently requires --json")
	}
	dir := qualityDiffReadDir(opts)
	aPath := resolveQualityDiffRecordPath(dir, a)
	bPath := resolveQualityDiffRecordPath(dir, b)
	runOpts := &qualityRunOpts{configPath: opts.configPath, cwd: opts.cwd}
	forwarder := newRunEventForwarder()
	defer forwarder.close()

	cmd, stdout, stderr, err := spawnQualityRunner(runOpts, []string{"--diff-a", aPath, "--diff-b", bPath}, forwarder.devtoolsURL())
	if err != nil {
		return err
	}
	go filterStderr(stderr)
	result := consumeQualityDiffStream(stdout, cmd.Wait, forwarder)
	if result.err != nil {
		return result.err
	}
	if result.exitCode != 0 {
		return domain.ExitError{Code: result.exitCode}
	}
	if len(result.diff) == 0 {
		return fmt.Errorf("quality diff worker did not return a diff")
	}
	_, err = fmt.Fprintln(out, string(result.diff))
	return err
}

func resolveQualityDiffRecordPath(dir, ref string) string {
	if filepath.IsAbs(ref) {
		return ref
	}
	if _, err := os.Stat(ref); err == nil {
		return ref
	}
	return filepath.Join(dir, "experiments", ref+".json")
}

func qualityDiffReadDir(opts qualityDiffOpts) string {
	if opts.dir != "" {
		return opts.dir
	}
	if opts.cwd != "" {
		return filepath.Join(opts.cwd, ".crux", "quality")
	}
	return qualityReadDir("")
}

type qualityDiffStreamResult struct {
	diff     json.RawMessage
	exitCode int
	err      error
}

func consumeQualityDiffStream(stdout io.Reader, wait func() error, forwarder qualityDiffForwarder) qualityDiffStreamResult {
	result := qualityDiffStreamResult{exitCode: 2}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if forwarder != nil {
			forwarder.forward(scanner.Bytes())
		}
		var event struct {
			Type     string          `json:"type"`
			Diff     json.RawMessage `json:"diff"`
			ExitCode int             `json:"exitCode"`
			Message  string          `json:"message"`
			Error    *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			result.err = err
			continue
		}
		switch event.Type {
		case "diff:done":
			result.diff = append(result.diff[:0], event.Diff...)
		case "error":
			result.err = errors.New(event.Message)
		case "run:done":
			result.exitCode = event.ExitCode
			if event.Error != nil && event.Error.Message != "" {
				result.err = errors.New(event.Error.Message)
			}
		}
	}
	if err := scanner.Err(); err != nil && result.err == nil {
		result.err = err
	}
	if err := wait(); err != nil && result.err == nil && result.exitCode == 0 {
		result.err = err
	}
	return result
}
