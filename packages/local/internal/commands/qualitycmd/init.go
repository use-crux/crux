package qualitycmd

import (
	"bufio"
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

type qualityInitOpts struct {
	configPath string
	cwd        string
	force      bool
}

type qualityInitTemplateData struct {
	EvalID         string
	ImportPath     string
	ImportName     string
	TaskExpression string
	DefinitionID   string
	SampleInput    string
}

type qualityInitTarget struct {
	DefinitionID   string          `json:"definitionId"`
	Kind           string          `json:"kind"`
	SourceFile     string          `json:"sourceFile"`
	ImportName     string          `json:"importName"`
	TaskExpression string          `json:"taskExpression"`
	SampleInput    json.RawMessage `json:"sampleInput,omitempty"`
}

// NewQualityInitCmd creates `crux quality init`.
func NewQualityInitCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityInitOpts{}
	cmd := &cobra.Command{
		Use:          "init [definition-id]",
		Short:        "Scaffold a starter eval for an indexed prompt, agent, or flow",
		Args:         cobra.MaximumNArgs(1),
		SilenceUsage: true,
		Example:      "  crux quality init prompt:support.answer\n  crux quality init prompt:support.answer --force",
		RunE: func(cmd *cobra.Command, args []string) error {
			definitionID := ""
			if len(args) > 0 {
				definitionID = args[0]
			}
			return runQualityInit(cmd.OutOrStdout(), definitionID, *opts)
		},
	}
	cmd.Flags().StringVar(&opts.configPath, "config", "", "Path to an optional crux.config.ts policy file")
	cmd.Flags().StringVar(&opts.cwd, "cwd", "", "Working directory for project discovery")
	cmd.Flags().BoolVar(&opts.force, "force", false, "Overwrite an existing eval scaffold")
	return cmd
}

const qualityInitEvalTemplate = `import { evaluate, scorers } from '@use-crux/core/quality'
import { {{.ImportName}} } from '{{.ImportPath}}'

export default evaluate('{{.EvalID}}', {
  task: {{.TaskExpression}},
  covers: ['{{.DefinitionID}}'],
  data: [
    { name: 'first trace-backed case', input: {{.SampleInput}} },
    // TODO: add an edge case from a trace or support ticket.
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output).toBeTruthy()
  },
  scorers: [
    scorers.exact(),
    // scorers.judge({ name: 'helpful', rubric: 'The answer resolves the question.', select: (o) => o }),
  ],
  // Next rungs (add keys, never restructure):
  // gates: { scores: { helpful: { min: 0.7 } } },
  // replay: 'record-new',   // then 'replay-strict' in CI
})

// Next:
//   crux quality run {{.EvalID}}
//   crux quality promote <experiment-id>
//   crux quality run {{.EvalID}} --replay replay-strict
`

func renderQualityInitEval(data qualityInitTemplateData) (string, error) {
	tmpl, err := template.New("quality-init-eval").Parse(qualityInitEvalTemplate)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
		return "", err
	}
	return out.String(), nil
}

func runQualityInit(out io.Writer, definitionID string, opts qualityInitOpts) error {
	targets, err := collectQualityInitTargets(opts, definitionID)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		if definitionID != "" {
			return fmt.Errorf("no importable Quality init target found for %s", definitionID)
		}
		return fmt.Errorf("no importable Quality init targets found")
	}
	if definitionID == "" && len(targets) > 1 {
		return fmt.Errorf("multiple init targets found; pass one definition id: %s", initTargetIDs(targets))
	}

	target := targets[0]
	projectDir, err := qualityInitProjectDir(opts.cwd, target.SourceFile)
	if err != nil {
		return err
	}
	evalID := safeQualityInitEvalID(target.DefinitionID)
	evalDir := filepath.Join(projectDir, "evals")
	if err := os.MkdirAll(evalDir, 0o755); err != nil {
		return err
	}
	evalPath := filepath.Join(evalDir, evalID+".eval.ts")
	if !opts.force {
		if _, err := os.Stat(evalPath); err == nil {
			return fmt.Errorf("%s already exists; pass --force to overwrite", evalPath)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	source, err := renderQualityInitEval(qualityInitTemplateData{
		EvalID:         evalID,
		ImportPath:     qualityInitImportPath(evalDir, target.SourceFile),
		ImportName:     target.ImportName,
		TaskExpression: target.TaskExpression,
		DefinitionID:   target.DefinitionID,
		SampleInput:    qualityInitSampleInput(target.SampleInput),
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(evalPath, []byte(source), 0o644); err != nil {
		return err
	}
	if err := ensureQualityInitSkill(projectDir); err != nil {
		return err
	}
	fmt.Fprintf(out, "Created %s\n", evalPath)
	fmt.Fprintf(out, "Next: crux quality run %s\n", evalID)
	return nil
}

func qualityInitProjectDir(cwd string, sourceFile string) (string, error) {
	if cwd == "" {
		return filepath.Dir(sourceFile), nil
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func collectQualityInitTargets(opts qualityInitOpts, definitionID string) ([]qualityInitTarget, error) {
	runOpts := &qualityRunOpts{configPath: opts.configPath, cwd: opts.cwd}
	extraArgs := []string{"--init-targets"}
	if definitionID != "" {
		extraArgs = append(extraArgs, "--definition", definitionID)
	}
	cmd, stdout, stderr, err := spawnQualityRunner(runOpts, extraArgs, "")
	if err != nil {
		return nil, err
	}
	go filterStderr(stderr)
	return consumeQualityInitTargets(stdout, cmd.Wait)
}

func consumeQualityInitTargets(stdout io.Reader, wait func() error) ([]qualityInitTarget, error) {
	var targets []qualityInitTarget
	var streamErr error
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var event struct {
			Type    string              `json:"type"`
			Targets []qualityInitTarget `json:"targets"`
			Message string              `json:"message"`
			Error   *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			streamErr = err
			continue
		}
		switch event.Type {
		case "init:targets":
			targets = event.Targets
		case "error":
			streamErr = fmt.Errorf("%s", event.Message)
		case "run:done":
			if event.Error != nil && event.Error.Message != "" {
				streamErr = fmt.Errorf("%s", event.Error.Message)
			}
		}
	}
	if err := scanner.Err(); err != nil && streamErr == nil {
		streamErr = err
	}
	if err := wait(); err != nil && streamErr == nil {
		streamErr = err
	}
	return targets, streamErr
}

func qualityInitImportPath(fromDir, sourceFile string) string {
	rel, err := filepath.Rel(fromDir, sourceFile)
	if err != nil {
		rel = sourceFile
	}
	rel = strings.TrimSuffix(rel, filepath.Ext(rel))
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, ".") {
		rel = "./" + rel
	}
	return rel
}

var qualityInitUnsafeID = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func safeQualityInitEvalID(definitionID string) string {
	return strings.Trim(qualityInitUnsafeID.ReplaceAllString(strings.ReplaceAll(definitionID, ":", "."), "-"), ".-")
}

func qualityInitSampleInput(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{ /* TODO: replace with real input */ }"
	}
	return string(raw)
}

func ensureQualityInitSkill(projectDir string) error {
	path := filepath.Join(projectDir, ".crux", "skills", "quality", "SKILL.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(qualityInitSkillTemplate), 0o644)
}

//go:embed assets/SKILL.md
var qualityInitSkillTemplate string

func initTargetIDs(targets []qualityInitTarget) string {
	ids := make([]string, 0, len(targets))
	for _, target := range targets {
		ids = append(ids, target.DefinitionID)
	}
	return strings.Join(ids, ", ")
}
