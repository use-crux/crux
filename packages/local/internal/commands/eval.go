package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
)

// NewEvalCmd creates "crux eval" — an undocumented argv-forwarding alias for
// `crux quality run` (spec 03 §1; help is Quality-branded). The legacy
// triple-pipeline implementation below stays compiled until phase 6 removes it.
func NewEvalCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "eval",
		Short:              "Run quality evaluations (alias for `crux quality run`)",
		Hidden:             true,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			run := NewQualityRunCmd()
			run.SetArgs(args)
			return run.Execute()
		},
	}
}

type evalOpts struct {
	configPath   string
	filter       string
	jsonOutput   string
	reportOutput string
	exportFailed string
	ciMode       bool
	cwd          string
}

// Type aliases for domain types used throughout this file.
type evalEvent = domain.EvalEvent
type evalRunResult = domain.EvalRunResult
type evalSummaryData = domain.EvalSummaryData

// --- CI mode (no TUI) ---

// filterStderr forwards only meaningful lines from the tsx process stderr.
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

func runEvalCI(opts evalOpts) error {
	cmd, stdout, stderr, err := spawnEvalRunner(opts)
	if err != nil {
		return err
	}

	go filterStderr(stderr)

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	var summaryData *evalSummaryData
	var exportData *json.RawMessage
	var analysisPrompt string

	for scanner.Scan() {
		var ev evalEvent
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}

		switch ev.Type {
		case "config":
			fmt.Fprintf(os.Stderr, "Loaded %s — %d evals, %d flow evals, %d RAG evals\n", ev.ConfigPath, ev.EvalCount, ev.FlowCount, ev.RagCount)
		case "eval:done":
			printCIResult(ev)
		case "flow:done":
			printCIResult(ev)
		case "rag:done":
			printCIRagResult(ev)
		case "quality:persisted":
			printCIQualityPersisted(ev)
		case "summary":
			if ev.Summary != nil {
				summaryData = &evalSummaryData{}
				if err := json.Unmarshal(*ev.Summary, summaryData); err != nil {
					fmt.Fprintf(os.Stderr, "warning: failed to parse summary: %v\n", err)
					summaryData = nil
				}
			}
			exportData = ev.Export
			analysisPrompt = ev.AnalysisPrompt
		case "error":
			fmt.Fprintf(os.Stderr, "ERROR: %s\n", ev.Message)
		}
	}

	cmd.Wait()

	// Output JSON/report if requested.
	if opts.jsonOutput != "" && exportData != nil {
		if err := writeOutput(opts.jsonOutput, *exportData); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write JSON output: %v\n", err)
		}
	}
	if opts.reportOutput != "" && analysisPrompt != "" {
		if err := writeStringOutput(opts.reportOutput, analysisPrompt); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write report output: %v\n", err)
		}
	}
	if opts.exportFailed != "" && exportData != nil {
		if err := writeFailedRagCases(opts.exportFailed, *exportData); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to export RAG failures: %v\n", err)
		}
	}

	// Print summary to stderr, JSON to stdout.
	if summaryData != nil {
		data, err := json.MarshalIndent(summaryData, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal summary: %w", err)
		}
		fmt.Println(string(data))
		return domain.ExitError{Code: summaryData.ExitCode}
	}

	return nil
}

func printCIResult(ev evalEvent) {
	if ev.Result == nil {
		return
	}
	var result evalRunResult
	if json.Unmarshal(*ev.Result, &result) != nil {
		return
	}

	status := strings.ToUpper(domain.DeriveStatus(&result))
	if status == "SUCCESS" {
		status = "PASS"
	}

	fmt.Fprintf(os.Stderr, "%s %s (%d cases, %.1fs)\n", status, result.Name, result.CaseCount, result.DurationMs/1000)
}

func printCIRagResult(ev evalEvent) {
	result, status := parseRagRunResult(ev)
	if result == nil {
		return
	}
	fmt.Fprintf(os.Stderr, "%s %s (%d RAG cases, %.1fs)\n", strings.ToUpper(status), result.Name, result.CaseCount, result.DurationMs/1000)
}

func printCIQualityPersisted(ev evalEvent) {
	if ev.QualityExperimentCount <= 0 {
		return
	}
	fmt.Fprintf(os.Stderr, "QUALITY persisted %d experiment(s)", ev.QualityExperimentCount)
	if len(ev.QualityExperimentIDs) > 0 {
		fmt.Fprintf(os.Stderr, ": %s", strings.Join(ev.QualityExperimentIDs, ", "))
	}
	fmt.Fprintln(os.Stderr)
}

// --- Interactive mode (Bubbletea) ---

func runEval(opts evalOpts) error {
	if opts.ciMode {
		return runEvalCI(opts)
	}

	cmd, stdout, stderr, err := spawnEvalRunner(opts)
	if err != nil {
		return err
	}

	go filterStderr(stderr)

	m := &evalModel{
		spinner: spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		entries: make(map[string]*evalEntry),
		opts:    opts,
	}
	m.spinner.Style = lipgloss.NewStyle().Foreground(output.AccentColor)

	p := tea.NewProgram(m)

	// Read NDJSON in background and send as Bubbletea messages.
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
		for scanner.Scan() {
			var ev evalEvent
			if json.Unmarshal(scanner.Bytes(), &ev) != nil {
				continue
			}
			p.Send(ev)
		}
		cmd.Wait()
		p.Send(evalDoneMsg{})
	}()

	finalModel, err := p.Run()
	if err != nil {
		return err
	}

	fm := finalModel.(*evalModel)

	// Output JSON/report if requested.
	if opts.jsonOutput != "" && fm.exportData != nil {
		if err := writeOutput(opts.jsonOutput, *fm.exportData); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write JSON output: %v\n", err)
		}
	}
	if opts.reportOutput != "" && fm.analysisPrompt != "" {
		if err := writeStringOutput(opts.reportOutput, fm.analysisPrompt); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to write report output: %v\n", err)
		}
	}
	if opts.exportFailed != "" && fm.exportData != nil {
		if err := writeFailedRagCases(opts.exportFailed, *fm.exportData); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to export RAG failures: %v\n", err)
		}
	}

	if fm.summary != nil {
		return domain.ExitError{Code: fm.summary.ExitCode}
	}
	return nil
}

// --- Bubbletea model ---

type evalEntry struct {
	name    string
	status  string // "running", "success", "error", "fail"
	result  *evalRunResult
	isFlow  bool
	isRag   bool
	started time.Time
}

type evalDoneMsg struct{}

type evalModel struct {
	spinner        spinner.Model
	entries        map[string]*evalEntry
	order          []string
	evalCount      int
	flowCount      int
	ragCount       int
	configPath     string
	completed      int
	total          int
	started        bool // true after first eval:start
	startedAt      time.Time
	summary        *evalSummaryData
	exportData     *json.RawMessage
	analysisPrompt string
	qualityIDs     []string
	done           bool
	err            string
	opts           evalOpts
}

func (m *evalModel) Init() tea.Cmd {
	return m.spinner.Tick
}

func (m *evalModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "ctrl+c" {
			return m, tea.Quit
		}

	case evalDoneMsg:
		m.done = true
		return m, tea.Quit

	case evalEvent:
		return m.handleEvent(msg)

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m *evalModel) handleEvent(ev evalEvent) (tea.Model, tea.Cmd) {
	switch ev.Type {
	case "config":
		m.evalCount = ev.EvalCount
		m.flowCount = ev.FlowCount
		m.ragCount = ev.RagCount
		m.configPath = ev.ConfigPath
		m.total = ev.EvalCount + ev.FlowCount + ev.RagCount
		m.startedAt = time.Now()

	case "eval:start":
		m.started = true
		key := "eval:" + ev.Name
		entry := &evalEntry{name: ev.Name, status: "running", started: time.Now()}
		m.entries[key] = entry
		m.order = append(m.order, key)

	case "eval:done":
		key := "eval:" + ev.Name
		if e, ok := m.entries[key]; ok {
			var result evalRunResult
			if ev.Result != nil {
				if err := json.Unmarshal(*ev.Result, &result); err != nil {
					result = evalRunResult{Name: ev.Name, Error: fmt.Sprintf("parse error: %v", err)}
				}
			}
			e.result = &result
			e.status = domain.DeriveStatus(&result)
			m.completed++
		}

	case "flow:start":
		key := "flow:" + ev.Name
		entry := &evalEntry{name: ev.Name, status: "running", isFlow: true, started: time.Now()}
		m.entries[key] = entry
		m.order = append(m.order, key)

	case "flow:done":
		key := "flow:" + ev.Name
		if e, ok := m.entries[key]; ok {
			var result evalRunResult
			if ev.Result != nil {
				if err := json.Unmarshal(*ev.Result, &result); err != nil {
					result = evalRunResult{Name: ev.Name, Error: fmt.Sprintf("parse error: %v", err)}
				}
			}
			e.result = &result
			e.status = domain.DeriveStatus(&result)
			m.completed++
		}

	case "rag:start":
		key := "rag:" + ev.Name
		entry := &evalEntry{name: ev.Name, status: "running", isRag: true, started: time.Now()}
		m.entries[key] = entry
		m.order = append(m.order, key)

	case "rag:done":
		key := "rag:" + ev.Name
		if e, ok := m.entries[key]; ok {
			result, status := parseRagRunResult(ev)
			if result != nil {
				e.result = result
				e.status = status
			}
			m.completed++
		}

	case "summary":
		if ev.Summary != nil {
			m.summary = &evalSummaryData{}
			if err := json.Unmarshal(*ev.Summary, m.summary); err != nil {
				m.summary = nil
			}
		}
		m.exportData = ev.Export
		m.analysisPrompt = ev.AnalysisPrompt

	case "quality:persisted":
		m.qualityIDs = append(m.qualityIDs, ev.QualityExperimentIDs...)

	case "error":
		m.err = ev.Message
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

func (m *evalModel) View() string {
	var sb strings.Builder

	// Header.
	sb.WriteString(fmt.Sprintf("  %s\n", output.Header("eval")))
	sb.WriteString("\n")

	// Config info.
	if m.configPath != "" {
		parts := []string{output.Bold.Render(m.configPath)}
		if m.evalCount > 0 {
			parts = append(parts, fmt.Sprintf("%d evals", m.evalCount))
		}
		if m.flowCount > 0 {
			parts = append(parts, fmt.Sprintf("%d flow evals", m.flowCount))
		}
		if m.ragCount > 0 {
			parts = append(parts, fmt.Sprintf("%d RAG evals", m.ragCount))
		}
		sb.WriteString(fmt.Sprintf("  %s\n\n", strings.Join(parts, output.Dim.Render(" — "))))
	}

	// Waiting state.
	if !m.started && !m.done && m.configPath != "" {
		sb.WriteString(fmt.Sprintf("  %s Discovering evals...\n", m.spinner.View()))
		return sb.String()
	}

	// Entries — one line per eval.
	for _, key := range m.order {
		entry := m.entries[key]
		if entry == nil {
			continue
		}

		icon := m.spinner.View()
		switch entry.status {
		case "success":
			icon = output.Green.Render("✓")
		case "fail":
			icon = output.Red.Render("✗")
		case "error":
			icon = output.Yellow.Render("!")
		}

		name := entry.name
		if entry.isFlow {
			name = output.Dim.Render("[flow] ") + name
		} else if entry.isRag {
			name = output.Dim.Render("[rag] ") + name
		}

		// Aggregate pass/total for completed evals.
		metrics := ""
		if entry.result != nil && entry.result.Report != nil {
			s := entry.result.Report.Summary
			total := s.Total
			passed := s.Passed
			passStr := fmt.Sprintf("%d/%d", passed, total)
			if s.Failed > 0 {
				passStr = output.Red.Render(passStr)
			} else {
				passStr = output.Green.Render(passStr)
			}
			metrics = fmt.Sprintf(" %s  %s",
				passStr,
				output.Dim.Render(output.FormatDuration(entry.result.DurationMs)))
		} else if entry.status == "running" {
			// Dot progress for running evals (show nothing — spinner is enough).
			metrics = ""
		}

		if entry.result != nil && entry.result.Error != "" {
			metrics = "  " + output.Red.Render(truncate(entry.result.Error, 50))
		}

		sb.WriteString(fmt.Sprintf("  %s %-28s%s\n", icon, name, metrics))

		// Show failures below the eval line.
		if entry.result != nil && entry.result.Report != nil {
			for _, cr := range entry.result.Report.Results {
				if !cr.Passed {
					errMsg := ""
					if cr.Error != "" {
						errMsg = ": " + truncate(cr.Error, 60)
					}
					sb.WriteString(fmt.Sprintf("    └ %s %s / %s%s\n",
						output.Red.Render("FAIL"),
						output.Dim.Render(output.ShortenModel(cr.ModelID)),
						cr.CaseName,
						output.Dim.Render(errMsg),
					))
				}
			}
		}
	}

	// Summary.
	if m.summary != nil {
		sb.WriteString("\n")
		sb.WriteString("  " + output.Divider.Render(strings.Repeat("─", 50)) + "\n")
		sb.WriteString("  " + output.Bold.Render("Summary") + "\n\n")

		total := m.summary.TotalPassed + m.summary.TotalFailed
		rate := float64(0)
		if total > 0 {
			rate = float64(m.summary.TotalPassed) / float64(total)
		}

		rateStyle := output.Green
		if m.summary.TotalFailed > 0 {
			rateStyle = output.Red
		}

		wallClock := ""
		if !m.startedAt.IsZero() {
			wallClock = output.FormatDuration(float64(time.Since(m.startedAt).Milliseconds()))
		}
		sb.WriteString(fmt.Sprintf("  %s passed  %s  %s  %s  %s  %s\n",
			output.Bold.Render(fmt.Sprintf("%d/%d", m.summary.TotalPassed, total)),
			rateStyle.Render(output.FormatPercent(rate)),
			output.FormatCost(m.summary.TotalCost),
			output.FormatTokens(m.summary.TotalTokens)+" tokens",
			wallClock,
			output.Dim.Render(fmt.Sprintf("exit %d", m.summary.ExitCode)),
		))

		// By model.
		if len(m.summary.ByModel) > 0 {
			sb.WriteString(fmt.Sprintf("\n  %s\n", output.Bold.Render("By Model")))
			for model, stats := range m.summary.ByModel {
				modelTotal := stats.Passed + stats.Failed
				modelRate := float64(0)
				if modelTotal > 0 {
					modelRate = float64(stats.Passed) / float64(modelTotal)
				}
				avgDur := float64(0)
				if modelTotal > 0 {
					avgDur = stats.DurationMs / float64(modelTotal)
				}
				sb.WriteString(fmt.Sprintf("    %-20s  %d/%d  %s  %s  avg %s\n",
					output.Dim.Render(output.ShortenModel(model)),
					stats.Passed, modelTotal,
					output.FormatPercent(modelRate),
					output.FormatCost(stats.Cost),
					output.FormatDuration(avgDur),
				))
			}
		}
		sb.WriteString("\n")
	}

	if len(m.qualityIDs) > 0 {
		sb.WriteString(fmt.Sprintf("  %s %d quality experiment(s) persisted\n",
			output.Green.Render("✓"),
			len(m.qualityIDs),
		))
		for _, id := range m.qualityIDs {
			sb.WriteString(fmt.Sprintf("    └ %s\n", output.Dim.Render(id)))
		}
		sb.WriteString("\n")
	}

	// Error.
	if m.err != "" {
		sb.WriteString(fmt.Sprintf("\n  %s %s\n", output.Red.Render("Error:"), m.err))
	}

	return sb.String()
}

// --- Helpers ---

func parseRagRunResult(ev evalEvent) (*evalRunResult, string) {
	if ev.Result == nil {
		return nil, "error"
	}
	var raw struct {
		Name       string  `json:"name"`
		Error      string  `json:"error,omitempty"`
		DurationMs float64 `json:"durationMs"`
		CaseCount  int     `json:"caseCount"`
		Report     *struct {
			Summary struct {
				Total  int `json:"total"`
				Passed int `json:"passed"`
				Failed int `json:"failed"`
			} `json:"summary"`
		} `json:"report,omitempty"`
	}
	if json.Unmarshal(*ev.Result, &raw) != nil {
		return nil, "error"
	}

	result := &evalRunResult{
		Name:       raw.Name,
		DurationMs: raw.DurationMs,
		CaseCount:  raw.CaseCount,
		Error:      raw.Error,
	}
	if raw.Report != nil {
		result.Report = &domain.EvalReport{
			Summary: domain.EvalReportSummary{
				Total:  raw.Report.Summary.Total,
				Passed: raw.Report.Summary.Passed,
				Failed: raw.Report.Summary.Failed,
				ByModel: map[string]domain.ModelCounts{
					"rag": {
						Total:  raw.Report.Summary.Total,
						Passed: raw.Report.Summary.Passed,
						Failed: raw.Report.Summary.Failed,
					},
				},
			},
		}
	}

	return result, domain.DeriveStatus(result)
}

func writeFailedRagCases(path string, exportData json.RawMessage) error {
	var data struct {
		RagEvals []struct {
			FailedCases *struct {
				Cases []json.RawMessage `json:"cases"`
			} `json:"failedCases"`
		} `json:"ragEvals"`
	}
	if err := json.Unmarshal(exportData, &data); err != nil {
		return err
	}

	cases := []json.RawMessage{}
	for _, ragEval := range data.RagEvals {
		if ragEval.FailedCases != nil {
			cases = append(cases, ragEval.FailedCases.Cases...)
		}
	}

	out, err := json.MarshalIndent(struct {
		ID    string            `json:"id"`
		Cases []json.RawMessage `json:"cases"`
	}{
		ID:    "rag-failures",
		Cases: cases,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0644)
}

func spawnEvalRunner(opts evalOpts) (*exec.Cmd, io.Reader, io.Reader, error) {
	nodePath, err := server.FindNode()
	if err != nil {
		return nil, nil, nil, err
	}

	runnerPath, err := server.ExtractEvalRunner()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to extract embedded eval runner: %w", err)
	}

	args := []string{"--import", "tsx/esm", runnerPath}
	if opts.configPath != "" {
		args = append(args, "--config", opts.configPath)
	}
	if opts.filter != "" {
		args = append(args, "--filter", opts.filter)
	}

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
		return nil, nil, nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, nil, nil, fmt.Errorf("failed to start eval runner: %w", err)
	}

	return cmd, stdout, stderr, nil
}

func writeOutput(pathOrEmpty string, data json.RawMessage) error {
	if pathOrEmpty == "" || pathOrEmpty == "true" {
		os.Stdout.Write(data)
		os.Stdout.Write([]byte("\n"))
		return nil
	}
	return os.WriteFile(pathOrEmpty, data, 0644)
}

func writeStringOutput(pathOrEmpty string, content string) error {
	if pathOrEmpty == "" || pathOrEmpty == "true" {
		fmt.Println(content)
		return nil
	}
	return os.WriteFile(pathOrEmpty, []byte(content), 0644)
}
