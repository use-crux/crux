package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Index is the Project Index screen: the design-plane sibling of
// the runtime Run list. Each row is a ProjectDefinition (prompt /
// context / tool / agent / flow / composition / suite / eval / …)
// surfaced from the Go service's index read-model.
//
// Per the backend handoff, the TUI is purely presentational:
//   - reads `c.ProjectIndex(ctx)` for the canonical view
//   - does NOT walk relations or compute fingerprints client-side
//   - missing Inspect renders as no signal, not as an error
//
// Cross-screen propagation: the workbench can read AffectedSuiteIDs() /
// AffectedEvalIDs() from this screen to mark rows on Suites/Insights
// as `affected` when their id appears in the union of all changed
// definitions' affected lists. See ADR-0051 + plan S15.
type Index struct {
	index  api.IndexData
	cursor int
	loaded bool
	err    string
}

// NewIndex constructs an empty Index screen.
func NewIndex() *Index { return &Index{} }

// SetIndexForTest is a test-only seed used by workbench integration
// tests to inject a index snapshot without going through Init's
// async fetch. Production code reaches index data via Update's
// indexLoadedMsg path.
func (s *Index) SetIndexForTest(data api.IndexData) {
	s.index = data
	s.loaded = true
	s.clampCursor()
}

func (s *Index) ID() string { return "index" }

func (s *Index) Init(c DataClient) tea.Cmd { return fetchIndex(c) }

func (s *Index) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainIndex)
}

func (s *Index) Counts() map[string]int {
	return map[string]int{"index": len(s.index.Definitions)}
}

func (s *Index) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case indexLoadedMsg:
		s.index = api.IndexData(m)
		s.loaded = true
		s.clampCursor()
	case api.InspectEvent:
		return fetchIndex(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyPressMsg:
		return s.handleKey(m, c)
	}
	return nil
}

func (s *Index) handleKey(m tea.KeyPressMsg, c DataClient) tea.Cmd {
	switch m.String() {
	case "j", "down":
		s.moveCursor(+1)
	case "k", "up":
		s.moveCursor(-1)
	case "enter":
		// Open source file in $EDITOR — stubbed for V1 (needs
		// `tea.ExecProcess` integration, same as Suites `^e`).
		return nil
	case "e":
		return s.exportDefinition()
	case "o":
		// External-viewer stub.
		return nil
	case "r":
		// `r run` is kind-dependent (prompt → one-shot run, suite →
		// experiment). Backend gap: `RunDefinition` service method
		// (plan B8). Stub until then.
		return s.runDefinitionStub()
	}
	return nil
}

func (s *Index) moveCursor(delta int) {
	n := len(s.index.Definitions)
	if n == 0 {
		return
	}
	next := s.cursor + delta
	if next < 0 {
		next = 0
	}
	if next >= n {
		next = n - 1
	}
	s.cursor = next
}

func (s *Index) clampCursor() {
	n := len(s.index.Definitions)
	if n == 0 {
		s.cursor = 0
		return
	}
	if s.cursor >= n {
		s.cursor = n - 1
	}
	if s.cursor < 0 {
		s.cursor = 0
	}
}

// SelectedDefinitionID returns the id of the cursor-focused definition.
func (s *Index) SelectedDefinitionID() string {
	defs := s.index.Definitions
	if s.cursor < 0 || s.cursor >= len(defs) {
		return ""
	}
	return defs[s.cursor].ID
}

func (s *Index) Breadcrumb() ([]string, string) {
	path := []string{"index"}
	if id := s.SelectedDefinitionID(); id != "" {
		path = append(path, id)
	}
	right := fmt.Sprintf("%d definitions", len(s.index.Definitions))
	return path, right
}

func (s *Index) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		shell.Bind("j/k", "move"), shell.Bind("↵", "open source"),
		shell.Bind("r", "run"), shell.Bind("e", "export"),
		shell.Bind("o", "open in viewer"),
		shell.Bind(":", "cmd"), shell.Bind("?", "help"),
	}
}

func (s *Index) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading index…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.index.Definitions) == 0 {
		return centerMsg(size, "no project definitions yet — open a file under your crux project to seed the index.")
	}
	listW := size.Width * 38 / 100
	if listW < 50 {
		listW = 50
	}
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	return kit.ComposeColumns(
		kit.PadBlock(list, listW, size.Height),
		kit.PadBlock(detail, detailW, size.Height),
	)
}

func (s *Index) renderList(width, height int) string {
	header := shell.PaneHeader(width, "Definitions",
		fmt.Sprintf("%d", len(s.index.Definitions)), "")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	count := 0
	for i, d := range s.index.Definitions {
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderListRow(d, width, i == s.cursor))
		b.WriteString("\n")
		count++
	}
	for ; count < bodyRows; count++ {
		b.WriteString(strings.Repeat(" ", width))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Index) renderListRow(d api.ProjectDefinition, width int, selected bool) string {
	bar := "  "
	if selected {
		bar = shell.SelectionBar(shell.ColorTeal) + " "
	}
	kindGlyph := indexKindGlyph(d.Kind)
	name := shell.Text.Render(d.Name)
	if d.Name == "" {
		name = shell.Text.Render(d.ID)
	}
	parts := []string{bar, kindGlyph, " ", name}
	// Fidelity chip (only when not resolved — saves chrome).
	if d.Fidelity != "" && d.Fidelity != "resolved" {
		parts = append(parts, " ", indexFidelityChip(d.Fidelity))
	}
	if count := len(s.lintFindingsForDefinition(d.ID)); count > 0 {
		parts = append(parts, " ", kit.ChipState(fmt.Sprintf("lint %d", count), shell.ColorAmber))
	}
	row := strings.Join(parts, "")
	return padRow(row, width)
}

func (s *Index) renderDetail(width, height int) string {
	if s.cursor < 0 || s.cursor >= len(s.index.Definitions) {
		return centerMsg(Size{Width: width, Height: height}, "no definition focused")
	}
	d := s.index.Definitions[s.cursor]

	var b strings.Builder
	header := shell.PaneHeader(width, d.Name, d.Kind, d.Fidelity)
	b.WriteString(header)
	b.WriteString("\n\n")

	b.WriteString(" " + shell.SectionTag.Render("IDENTITY"))
	b.WriteString("\n")
	b.WriteString(kvRow("id", d.ID, width))
	b.WriteString(kvRow("kind", d.Kind, width))
	if d.Description != "" {
		b.WriteString(kvRow("desc", truncate(d.Description, width-12), width))
	}
	if len(d.Tags) > 0 {
		b.WriteString(kvRow("tags", strings.Join(d.Tags, ", "), width))
	}
	if d.Fingerprint != "" {
		b.WriteString(kvRow("fingerprint", truncate(d.Fingerprint, 12), width))
	}
	b.WriteString("\n")

	if d.Source != nil {
		b.WriteString(" " + shell.SectionTag.Render("SOURCE"))
		b.WriteString("\n")
		b.WriteString(kvRow("file", d.Source.File, width))
		if d.Source.Line > 0 {
			b.WriteString(kvRow("line", fmt.Sprintf("%d", d.Source.Line), width))
		}
		b.WriteString("\n")
	}

	if d.Quality != nil {
		b.WriteString(" " + shell.SectionTag.Render("EVAL RUNS"))
		b.WriteString("\n")
		if d.Quality.RunCount > 0 {
			b.WriteString(kvRow("runs", fmt.Sprintf("%d", d.Quality.RunCount), width))
		}
		if d.Quality.PassRate != nil {
			b.WriteString(kvRow("pass rate", fmt.Sprintf("%.0f%%", *d.Quality.PassRate*100), width))
		}
		b.WriteString("\n")
	}

	lintFindings := s.lintFindingsForDefinition(d.ID)
	if len(lintFindings) > 0 {
		b.WriteString(" " + shell.SectionTag.Render("LINT"))
		b.WriteString("\n")
		for _, finding := range lintFindings {
			label := fmt.Sprintf("%s · %s", finding.Severity, finding.Title)
			b.WriteString(kvRow(finding.RuleID, truncate(label, width-12), width))
			if finding.Rationale != "" {
				b.WriteString(kvRow("why", truncate(finding.Rationale, width-12), width))
			}
			if finding.DocsURL != "" {
				b.WriteString(kvRow("docs", truncate(finding.DocsURL, width-12), width))
			}
		}
		b.WriteString("\n")
	}

	return strings.TrimRight(b.String(), "\n")
}

func (s *Index) lintFindingsForDefinition(definitionID string) []api.IndexLintFinding {
	if definitionID == "" || len(s.index.LintFindings) == 0 {
		return nil
	}
	findings := make([]api.IndexLintFinding, 0)
	for _, finding := range s.index.LintFindings {
		if indexLintFindingReferencesDefinition(finding, definitionID) {
			findings = append(findings, finding)
		}
	}
	return findings
}

func indexLintFindingReferencesDefinition(finding api.IndexLintFinding, definitionID string) bool {
	if finding.PrimaryDefinitionID == definitionID {
		return true
	}
	return stringSliceContains(finding.RelatedDefinitionIDs, definitionID) ||
		stringSliceContains(finding.AffectedDefinitionIDs, definitionID) ||
		stringSliceContains(finding.PropagatedDefinitionIDs, definitionID)
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// indexKindGlyph picks a small one-rune-ish glyph by definition kind.
// Stable colors keep scanning consistent at a glance.
func indexKindGlyph(kind string) string {
	switch kind {
	case "prompt":
		return shell.Teal.Render("⌬")
	case "context":
		return shell.Teal.Render("≣")
	case "tool":
		return shell.Teal.Render("⚒")
	case "agent":
		return shell.Teal.Render("◆")
	case "flow":
		return shell.Teal.Render("⇄")
	case "flow.step":
		return shell.Teal.Render("↳")
	case "composition.parallel", "composition.parallel.branch":
		return shell.Teal.Render("∥")
	case "composition.pipeline", "composition.pipeline.stage":
		return shell.Teal.Render("▸")
	case "composition.consensus":
		return shell.Teal.Render("◎")
	case "composition.swarm":
		return shell.Teal.Render("✦")
	case "memory", "memory.block", "memory.store", "blackboard":
		return shell.Teal.Render("▣")
	case "rag.pipeline", "rag.pipeline.stage", "rag.retriever":
		return shell.Teal.Render("⌁")
	case "suite", "eval":
		return shell.Teal.Render("✓")
	default:
		return shell.TextMuted.Render("·")
	}
}

func indexFidelityChip(fidelity string) string {
	switch fidelity {
	case "partial":
		return kit.ChipState("partial", shell.ColorAmber)
	case "error":
		return kit.ChipState("error", shell.ColorRose)
	default:
		return kit.ChipTag(fidelity)
	}
}

// clipIDs joins ids with " · " and tail-truncates to fit width.
func clipIDs(ids []string, width int) string {
	joined := strings.Join(ids, " · ")
	if lipgloss.Width(joined) <= width {
		return joined
	}
	return truncate(joined, width)
}

// exportDefinition writes the focused definition to
// ~/.crux/exports/definition-{id}.json.
func (s *Index) exportDefinition() tea.Cmd {
	if s.cursor < 0 || s.cursor >= len(s.index.Definitions) {
		return nil
	}
	d := s.index.Definitions[s.cursor]
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		// Replace slashes in the id (e.g. "prompt:writer.prompt") so
		// the filename is safe across platforms.
		safe := strings.NewReplacer(":", "_", "/", "_").Replace(d.ID)
		path := filepath.Join(dir, "definition-"+truncate(safe, 64)+".json")
		body, err := json.MarshalIndent(d, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return definitionExportedMsg{defID: d.ID, path: path}
	}
}

// runDefinitionStub is the placeholder until `RunDefinition` service
// method lands (plan B8). The kind dispatch (prompt → one-shot,
// suite → experiment, etc.) is service-side per the handoff.
func (s *Index) runDefinitionStub() tea.Cmd {
	id := s.SelectedDefinitionID()
	if id == "" {
		return nil
	}
	return func() tea.Msg { return definitionRunPendingMsg{defID: id} }
}

type (
	indexLoadedMsg          api.IndexData
	definitionExportedMsg   struct{ defID, path string }
	definitionRunPendingMsg struct{ defID string }
)

func fetchIndex(c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		rec, err := c.ProjectIndex(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return indexLoadedMsg(rec)
	}
}
