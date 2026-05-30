package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/components"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Datasets is the Suites workbench screen. The struct keeps the legacy
// name for compatibility with workbench wiring while the user-facing label
// and route ID are "Suites" (per the Quality RFC vocabulary).
//
// 3-pane layout: suite list │ cases list │ case editor (INSERT mode).
type Datasets struct {
	items        []api.QualitySuiteRecord
	selectedID   string
	selectedCase string
	loaded       bool
	err          string

	// affectedSuites is the cross-screen propagation slot: the workbench
	// reads `AffectedSuiteIDs` from the Catalog screen (set-union of
	// all ChangedSinceBaseline definitions' affected lists) and writes
	// the set here. The renderer marks matching list rows with an
	// `affected` chip. Backend-owned per the catalog handoff — TUI
	// never walks relations to compute this.
	affectedSuites map[string]struct{}

	// INSERT mode state. Name lives in the title (not directly editable in
	// the editor body — it's renamed via a separate action key); the body
	// only edits tags, input, and expected.
	editing       bool
	editField     editField
	editTags      textinput.Model
	editInput     textarea.Model
	editExpected  textarea.Model
	editDirty     bool
	editStatusMsg string
}

type editField int

const (
	fieldTags editField = iota
	fieldInput
	fieldExpected
	fieldsTotal
)

// NewDatasets constructs the Suites screen with prepared edit widgets.
func NewDatasets() *Datasets {
	d := &Datasets{}

	d.editTags = textinput.New()
	d.editTags.Placeholder = "comma,separated,tags"
	d.editTags.CharLimit = 200
	d.editTags.Prompt = ""

	d.editInput = textarea.New()
	d.editInput.Placeholder = "case input (JSON or text)"
	d.editInput.ShowLineNumbers = false
	d.editInput.SetWidth(48)
	d.editInput.SetHeight(6)

	d.editExpected = textarea.New()
	d.editExpected.Placeholder = "expected output / rubric"
	d.editExpected.ShowLineNumbers = false
	d.editExpected.SetWidth(48)
	d.editExpected.SetHeight(6)

	return d
}

func (s *Datasets) ID() string                { return "suites" }
func (s *Datasets) Init(c DataClient) tea.Cmd { return fetchSuites(c) }
func (s *Datasets) Counts() map[string]int    { return map[string]int{"suites": len(s.items)} }

// Editing reports whether the embedded case editor is focused. The
// workbench uses this to forward every key straight to the screen so the
// textarea/textinput widgets receive raw input. Per ADR-0050 there is no
// global mode flag — this is a pass-through hint, not a mode.
func (s *Datasets) Editing() bool { return s.editing }

// SetAffectedSuiteIDs accepts the set of suite ids the workbench has
// derived from the Catalog screen's union of ChangedSinceBaseline
// definitions. The Suites list renders an `affected` chip on matching
// rows so users see at a glance which suites need re-running after a
// definition change.
func (s *Datasets) SetAffectedSuiteIDs(set map[string]struct{}) {
	s.affectedSuites = set
}

// AffectedSuiteIDs returns the currently-stored set so the workbench
// (and tests) can verify propagation. Returns nil when nothing has
// been set yet.
func (s *Datasets) AffectedSuiteIDs() map[string]struct{} {
	return s.affectedSuites
}

func (s *Datasets) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case suitesLoadedMsg:
		s.items = []api.QualitySuiteRecord(m)
		s.loaded = true
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].SuiteID
			if cur := s.currentSuite(); cur != nil && len(cur.Cases) > 0 {
				s.selectedCase = cur.Cases[0].CaseID
			}
		}
	case api.QualityEvent:
		// Don't clobber an in-flight edit on background refreshes.
		if s.editing {
			return nil
		}
		return fetchSuites(c)
	case caseSavedMsg:
		s.editStatusMsg = "saved"
		s.editDirty = false
		// Refresh from the server-merged record.
		s.applySuite(api.QualitySuiteRecord(m))
		return nil
	case dataErrMsg:
		if s.editing {
			s.editStatusMsg = "save failed: " + string(m)
		} else {
			s.err = string(m)
		}
	case tea.KeyMsg:
		return s.handleKey(m, c)
	}
	return nil
}

func (s *Datasets) handleKey(m tea.KeyMsg, c DataClient) tea.Cmd {
	if s.editing {
		return s.handleEditKey(m, c)
	}
	switch m.String() {
	case "j", "down":
		s.moveCase(1)
	case "k", "up":
		s.moveCase(-1)
	case "shift+j", "J":
		s.moveDataset(1)
	case "shift+k", "K":
		s.moveDataset(-1)
	case "i", "enter":
		// `i` (vim insert) or ↵ opens the case editor. `e` is reserved
		// for the Layer-2 export verb per KEYBINDS.md.
		return s.enterEdit()
	case "e":
		return s.exportSuite()
	case "n":
		return s.newCase()
	case "x":
		return s.removeCase()
	case "D":
		// Destructive (uppercase per KEYBINDS contract). Backend method
		// `DeleteSuite` doesn't exist yet — returns a stub cmd so the
		// keystroke produces an observable effect now and lights up
		// when the backend lands.
		return s.deleteSuiteStub()
	case "o":
		// Open the focused suite in the external React devtools UI.
		// Stub until URL scheme is documented — matches Runs S7.
		return nil
	}
	return nil
}

// removeCase optimistically prunes the focused case from the local list
// and emits a cmd that calls `c.DeleteSuiteCase` once that backend
// service method exists. Lowercase `x` per KEYBINDS — the case can be
// re-added via `n` if removal was a mistake.
func (s *Datasets) removeCase() tea.Cmd {
	cur := s.currentSuite()
	if cur == nil || s.selectedCase == "" {
		return nil
	}
	idx := -1
	for i, it := range s.items {
		if it.SuiteID == cur.SuiteID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	removed := s.selectedCase
	kept := make([]api.QualitySuiteCase, 0, len(s.items[idx].Cases))
	for _, kase := range s.items[idx].Cases {
		if kase.CaseID == removed {
			continue
		}
		kept = append(kept, kase)
	}
	s.items[idx].Cases = kept
	// Slide selection to the next available case.
	if len(kept) > 0 {
		s.selectedCase = kept[0].CaseID
	} else {
		s.selectedCase = ""
	}
	// Stub cmd: when DeleteSuiteCase lands on the DataClient, replace
	// this with a real call. Returning a non-nil cmd lets the caller
	// observe that the keystroke produced an effect.
	suiteID := cur.SuiteID
	return func() tea.Msg {
		return caseRemovedLocallyMsg{suiteID: suiteID, caseID: removed}
	}
}

// caseRemovedLocallyMsg is the placeholder result of `x` until the
// backend's DeleteSuiteCase method is wired through DataClient.
type caseRemovedLocallyMsg struct {
	suiteID string
	caseID  string
}

// deleteSuiteStub returns a non-nil tea.Cmd that surfaces the
// "backend pending" state to the activity feed once we wire the
// workbench to consume it. When `QualityService.DeleteSuite` lands,
// replace with a real call that emits the suite-deleted message.
func (s *Datasets) deleteSuiteStub() tea.Cmd {
	cur := s.currentSuite()
	if cur == nil {
		return nil
	}
	suiteID := cur.SuiteID
	return func() tea.Msg {
		return deleteSuitePendingMsg{suiteID: suiteID}
	}
}

// deleteSuitePendingMsg is the placeholder result of `D` while the
// backend `DeleteSuite` method is a gap.
type deleteSuitePendingMsg struct{ suiteID string }

// newCase drafts a fresh empty case in the focused suite, selects it,
// and enters edit mode pointed at it. The new case carries the
// `draft` tag so the case list can render it distinctively. No-op
// when no suite is focused. See plan S10.
func (s *Datasets) newCase() tea.Cmd {
	cur := s.currentSuite()
	if cur == nil {
		return nil
	}
	// Find the suite index in `items` so we can mutate Cases in place.
	idx := -1
	for i, it := range s.items {
		if it.SuiteID == cur.SuiteID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	caseID := generateDraftCaseID(s.items[idx].Cases)
	draft := api.QualitySuiteCase{
		CaseID: caseID,
		Tags:   []string{"draft"},
	}
	s.items[idx].Cases = append(s.items[idx].Cases, draft)
	s.selectedCase = caseID
	return s.enterEdit()
}

// generateDraftCaseID picks a non-colliding "case-draft-N" id.
func generateDraftCaseID(existing []api.QualitySuiteCase) string {
	seen := make(map[string]struct{}, len(existing))
	for _, c := range existing {
		seen[c.CaseID] = struct{}{}
	}
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("case-draft-%d", i)
		if _, taken := seen[candidate]; !taken {
			return candidate
		}
	}
}

// exportSuite returns a tea.Cmd that writes the focused suite as
// pretty-printed JSON to ~/.crux/exports/suite-{id}.json. No-op when
// nothing focused.
func (s *Datasets) exportSuite() tea.Cmd {
	cur := s.currentSuite()
	if cur == nil {
		return nil
	}
	rec := *cur
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		path := filepath.Join(dir, "suite-"+truncate(rec.SuiteID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return suiteExportedMsg{suiteID: rec.SuiteID, path: path}
	}
}

// suiteExportedMsg is emitted on a successful suite export.
type suiteExportedMsg struct {
	suiteID string
	path    string
}

func (s *Datasets) handleEditKey(m tea.KeyMsg, c DataClient) tea.Cmd {
	key := m.String()
	switch key {
	case "esc":
		s.exitEdit()
		return nil
	case "ctrl+s":
		return s.saveCase(c)
	case "tab":
		s.cycleField(1)
		return nil
	case "shift+tab":
		s.cycleField(-1)
		return nil
	}

	// Pass through to the active widget.
	var cmd tea.Cmd
	switch s.editField {
	case fieldTags:
		s.editTags, cmd = s.editTags.Update(m)
	case fieldInput:
		s.editInput, cmd = s.editInput.Update(m)
	case fieldExpected:
		s.editExpected, cmd = s.editExpected.Update(m)
	}
	s.editDirty = true
	s.editStatusMsg = ""
	return cmd
}

func (s *Datasets) enterEdit() tea.Cmd {
	c := s.currentCase()
	if c == nil {
		return nil
	}
	s.editing = true
	s.editField = fieldTags
	s.editTags.SetValue(strings.Join(c.Tags, ","))
	s.editInput.SetValue(jsonOrString(c.Input))
	s.editExpected.SetValue(jsonOrString(c.Expected))
	s.focusField()
	s.editDirty = false
	s.editStatusMsg = ""
	return textinput.Blink
}

func (s *Datasets) exitEdit() {
	s.editing = false
	s.editTags.Blur()
	s.editInput.Blur()
	s.editExpected.Blur()
	s.editStatusMsg = ""
}

func (s *Datasets) cycleField(delta int) {
	s.editField = editField((int(s.editField) + delta + int(fieldsTotal)) % int(fieldsTotal))
	s.focusField()
}

func (s *Datasets) focusField() {
	s.editTags.Blur()
	s.editInput.Blur()
	s.editExpected.Blur()
	switch s.editField {
	case fieldTags:
		s.editTags.Focus()
	case fieldInput:
		s.editInput.Focus()
	case fieldExpected:
		s.editExpected.Focus()
	}
}

func (s *Datasets) saveCase(c DataClient) tea.Cmd {
	cur := s.currentSuite()
	src := s.currentCase()
	if cur == nil || src == nil {
		return nil
	}

	tags := []string{}
	for _, t := range strings.Split(s.editTags.Value(), ",") {
		if t = strings.TrimSpace(t); t != "" {
			tags = append(tags, t)
		}
	}

	updated := api.QualitySuiteCase{
		CaseID:   src.CaseID,
		Name:     src.Name,
		Tags:     tags,
		Metadata: src.Metadata,
		Origin:   src.Origin,
		Input:    parseJSONValue(s.editInput.Value()),
		Expected: parseJSONValue(s.editExpected.Value()),
	}
	suiteID := cur.SuiteID
	return func() tea.Msg {
		rec, err := c.UpsertSuiteCase(context.Background(), suiteID, updated)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return caseSavedMsg(rec)
	}
}

// applySuite replaces the matching item in the items list.
func (s *Datasets) applySuite(rec api.QualitySuiteRecord) {
	for i, it := range s.items {
		if it.SuiteID == rec.SuiteID {
			s.items[i] = rec
			break
		}
	}
}

func (s *Datasets) Breadcrumb() ([]string, string) {
	path := []string{"suites"}
	if cur := s.currentSuite(); cur != nil {
		path = append(path, cur.SuiteID)
	}
	if s.editing {
		return append(path, "edit"), s.editFieldLabel()
	}
	return path, fmt.Sprintf("%d suites", len(s.items))
}

func (s *Datasets) Keybinds() []shell.Keybind {
	if s.editing {
		return []shell.Keybind{
			{"esc", "back"}, {"tab", "next field"}, {"shift+tab", "prev"},
			{"^s", "save"}, {":", "cmd"}, {"?", "help"},
		}
	}
	return []shell.Keybind{
		{"j/k", "case"}, {"J/K", "suite"},
		{"i", "edit"}, {"n", "new case"},
		{"x", "remove case"}, {"D", "delete suite"},
		{"e", "export"}, {"o", "open in viewer"},
		{":", "cmd"}, {"?", "help"},
		// `r re-run`, `d duplicate`, and `N new suite` intentionally
		// absent — backend methods (RerunCase, SaveSuite-via-overlay)
		// not yet wired. See plan S10.
	}
}

func (s *Datasets) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading suites…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no suites yet — press N to create one, or save a Run as a Case from the Runs screen.")
	}
	listW := 28
	caseW := size.Width / 3
	detailW := size.Width - listW - caseW - 2
	if s.editing {
		// Give more room to the editor.
		caseW = size.Width / 4
		detailW = size.Width - listW - caseW - 2
		s.editInput.SetWidth(detailW - 6)
		s.editExpected.SetWidth(detailW - 6)
	}
	dsList := s.renderDatasetList(listW, size.Height)
	caseList := s.renderCaseList(caseW, size.Height)
	caseDetail := s.renderCaseDetail(detailW, size.Height)
	return shell.Compose(
		shell.PadColumnHeight(dsList, listW, size.Height),
		shell.PadColumnHeight(caseList, caseW, size.Height),
		shell.PadColumnHeight(caseDetail, detailW, size.Height),
	)
}

func (s *Datasets) renderDatasetList(width, height int) string {
	header := shell.PaneHeader(width, "Suites", fmt.Sprintf("%d", len(s.items)), "")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	count := 0
	for _, it := range s.items {
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderDatasetRow(it, width, it.SuiteID == s.selectedID))
		b.WriteString("\n")
		count++
	}
	for count < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		count++
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Datasets) renderDatasetRow(it api.QualitySuiteRecord, width int, selected bool) string {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	glyph, color := datasetStateGlyph(it.State)
	stateChip := ""
	if it.State != "" {
		stateChip = "  " + components.ChipState(it.State, color)
	}
	srcChip := ""
	if it.Source != "" {
		srcChip = "  " + components.ChipTag(it.Source)
	}
	// `width-30` reserves columns for the glyph + chips + count;
	// clamp the lower bound so very narrow panes still render
	// (truncate handles n=0 by returning empty, but a usable name is
	// nicer than disappearing it).
	nameW := width - 30
	if nameW < 8 {
		nameW = 8
	}
	line1 := fmt.Sprintf("%s%s %s%s%s  %s", bar,
		lipgloss.NewStyle().Foreground(color).Render(glyph),
		shell.Text.Render(truncate(suiteName(it), nameW)),
		stateChip,
		srcChip,
		shell.TextMuted.Render(fmt.Sprintf("%d", it.CaseCount)),
	)
	// One row per suite — the legacy two-row layout repeated state text
	// in dim grey under the row, which duplicated the new state chip.
	return padRow(line1, width)
}

func (s *Datasets) renderCaseList(width, height int) string {
	cur := s.currentSuite()
	if cur == nil {
		return ""
	}
	header := shell.PaneHeader(width, suiteName(*cur),
		fmt.Sprintf("%s · %d cases", cur.State, cur.CaseCount), "")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	count := 0
	for _, c := range cur.Cases {
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderCaseRow(c, width, c.CaseID == s.selectedCase))
		b.WriteString("\n")
		count++
	}
	for count < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		count++
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Datasets) renderCaseRow(c api.QualitySuiteCase, width int, selected bool) string {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	name := c.Name
	if name == "" {
		name = c.CaseID
	}
	id := shell.TextMuted.Render(truncate(c.CaseID, 8))
	line1 := fmt.Sprintf("%s%s  %s", bar, id, shell.Text.Render(truncate(name, width-12)))
	tags := ""
	if len(c.Tags) > 0 {
		tags = strings.Join(c.Tags, " ")
	}
	line2 := "      " + shell.TextMuted.Render(truncate(tags, width-8))
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Datasets) renderCaseDetail(width, height int) string {
	cur := s.currentSuite()
	if cur == nil {
		return ""
	}
	c := s.currentCase()
	if c == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a case")
	}
	if s.editing {
		return s.renderCaseEditor(width, height)
	}
	return s.renderCaseReadOnly(c, width, height)
}

func (s *Datasets) renderCaseReadOnly(c *api.QualitySuiteCase, width, height int) string {
	name := c.Name
	if name == "" {
		name = c.CaseID
	}
	header := shell.PaneHeader(width, c.CaseID+" · "+name, "", shell.TextMuted.Render("read-only · press [i] or [↵] to edit"))
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	if len(c.Tags) > 0 {
		b.WriteString(" " + shell.SectionTag.Render("TAGS") + "\n ")
		b.WriteString(shell.TextDim.Render(strings.Join(c.Tags, "  ")))
		b.WriteString("\n\n")
	}
	if c.Input != nil {
		b.WriteString(" " + shell.SectionTag.Render("INPUT") + "\n")
		b.WriteString(boxedPre(jsonOrString(c.Input), width-2))
		b.WriteString("\n\n")
	}
	if c.Expected != nil {
		b.WriteString(" " + shell.SectionTag.Render("EXPECTED") + "\n")
		b.WriteString(boxedPre(jsonOrString(c.Expected), width-2))
		b.WriteString("\n\n")
	}
	if len(c.Assertions) > 0 {
		b.WriteString(" " + shell.SectionTag.Render("ASSERTIONS") + "\n")
		for _, a := range c.Assertions {
			b.WriteString(renderAssertionRow(a, width))
			b.WriteString("\n")
		}
	}
	footer := shell.PaneFooter(width, []shell.Keybind{
		{"e", "edit"}, {"r", "re-run"}, {"d", "duplicate"}, {"x", "delete"},
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

func (s *Datasets) renderCaseEditor(width, height int) string {
	c := s.currentCase()
	if c == nil {
		return ""
	}
	name := c.Name
	if name == "" {
		name = c.CaseID
	}

	// Title bar: case-id · name + UNSAVED + SEED chips.
	right := ""
	if s.editDirty || s.editStatusMsg != "" {
		badge := lipgloss.NewStyle().
			Background(shell.ColorPanelAlt).
			Foreground(shell.ColorAmber).
			Padding(0, 1).
			Render(strings.ToUpper(s.editStatusBadge()))
		right = badge + " "
	}
	seed := lipgloss.NewStyle().
		Background(shell.ColorPanelAlt).
		Foreground(shell.ColorTextDim).
		Padding(0, 1).
		Render("SEED: 42")
	right += seed
	header := shell.PaneHeader(width, c.CaseID+" · "+truncate(name, width-30), "", right)

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	// TAGS: chip row of existing tags + edit field.
	b.WriteString(s.renderFieldHeader("TAGS", s.editField == fieldTags))
	b.WriteString("\n")
	b.WriteString(renderTagChipRow(c.Tags, width))
	b.WriteString("\n")
	if s.editField == fieldTags {
		b.WriteString(" " + s.editTags.View())
		b.WriteString("\n")
	}
	b.WriteString("\n")

	// INPUT
	b.WriteString(s.renderFieldHeader("INPUT", s.editField == fieldInput))
	b.WriteString("\n")
	if s.editField == fieldInput {
		b.WriteString(s.editInput.View())
	} else {
		b.WriteString(boxedPre(jsonOrString(c.Input), width-2))
	}
	b.WriteString("\n\n")

	// EXPECTED OUTPUT (RUBRIC)
	b.WriteString(s.renderFieldHeader("EXPECTED OUTPUT (RUBRIC)", s.editField == fieldExpected))
	b.WriteString("\n")
	if s.editField == fieldExpected {
		b.WriteString(s.editExpected.View())
	} else {
		b.WriteString(rubricPre(jsonOrString(c.Expected), width-2))
	}
	b.WriteString("\n\n")

	// ASSERTIONS (read-only table)
	if len(c.Assertions) > 0 {
		b.WriteString(" " + shell.SectionTag.Render("ASSERTIONS"))
		b.WriteString("\n")
		for _, a := range c.Assertions {
			b.WriteString(renderAssertionRow(a, width))
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	// METADATA (read-only)
	b.WriteString(" " + shell.SectionTag.Render("METADATA"))
	b.WriteString("\n")
	if o := stringifyOrigin(c.Origin); o != "" {
		b.WriteString(kvRow("origin", o, width))
	}
	if c.LastRunAt != "" {
		b.WriteString(kvRow("last run", c.LastRunAt, width))
	}
	if c.LastRunExperimentID != "" {
		b.WriteString(kvRow("last exp", c.LastRunExperimentID, width))
	}
	if c.LastRunStatus != "" {
		b.WriteString(kvRow("last status", c.LastRunStatus, width))
	}
	if c.FeedbackRating != "" {
		rating := c.FeedbackRating
		if rating == "down" {
			rating = "👎 thumb-down"
		} else if rating == "up" {
			rating = "👍 thumb-up"
		}
		b.WriteString(kvRow("rating", rating, width))
	}

	// Footer action bar — keys swap based on mode.
	var footer string
	if s.editing {
		footer = shell.PaneFooter(width, []shell.Keybind{
			{"^s", "save"}, {"^z", "undo"},
			{"tab", "field"}, {"esc", "cancel"},
		})
	} else {
		footer = shell.PaneFooter(width, []shell.Keybind{
			{"e", "edit"}, {"r", "re-run case"},
			{"d", "duplicate"}, {"x", "delete"},
		})
	}
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

// renderTagChipRow renders the design's "[RETRIEVAL] [DOCS] [TYPED-PROMPTS] + add" line.
func renderTagChipRow(tags []string, width int) string {
	chip := func(t string) string {
		return lipgloss.NewStyle().
			Background(shell.ColorPanelAlt).
			Foreground(shell.ColorTextDim).
			Padding(0, 1).
			MarginRight(1).
			Render(strings.ToUpper(t))
	}
	var parts []string
	for _, t := range tags {
		parts = append(parts, chip(t))
	}
	parts = append(parts, shell.TextMuted.Render("+ add"))
	row := " " + strings.Join(parts, "")
	if w := lipgloss.Width(row); w < width {
		row += strings.Repeat(" ", width-w)
	}
	return row
}

// rubricPre is the teal-tinted variant of boxedPre used for expected-output rubrics.
func rubricPre(text string, width int) string {
	style := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		Foreground(shell.ColorText).
		BorderForeground(shell.ColorTealDark).
		Padding(0, 1).
		Width(width)
	return style.Render(text)
}

func stringifyOrigin(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return jsonOrString(v)
}

func (s *Datasets) renderFieldHeader(label string, focused bool) string {
	tag := shell.SectionTag.Render(label)
	if focused {
		return " " + lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌") + " " + tag
	}
	return "   " + tag
}

func (s *Datasets) editFieldLabel() string {
	switch s.editField {
	case fieldTags:
		return "tags"
	case fieldInput:
		return "input"
	case fieldExpected:
		return "expected"
	}
	return ""
}

func (s *Datasets) editStatusBadge() string {
	if s.editStatusMsg != "" {
		return s.editStatusMsg
	}
	if s.editDirty {
		return "unsaved"
	}
	return ""
}

func (s *Datasets) moveCase(delta int) {
	cur := s.currentSuite()
	if cur == nil || len(cur.Cases) == 0 {
		return
	}
	idx := 0
	for i, c := range cur.Cases {
		if c.CaseID == s.selectedCase {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cur.Cases) {
		idx = len(cur.Cases) - 1
	}
	s.selectedCase = cur.Cases[idx].CaseID
}

func (s *Datasets) moveDataset(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.SuiteID == s.selectedID {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(s.items) {
		idx = len(s.items) - 1
	}
	s.selectedID = s.items[idx].SuiteID
	if cur := s.currentSuite(); cur != nil && len(cur.Cases) > 0 {
		s.selectedCase = cur.Cases[0].CaseID
	}
}

func (s *Datasets) currentSuite() *api.QualitySuiteRecord {
	for i, it := range s.items {
		if it.SuiteID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) > 0 {
		return &s.items[0]
	}
	return nil
}

func (s *Datasets) currentCase() *api.QualitySuiteCase {
	cur := s.currentSuite()
	if cur == nil {
		return nil
	}
	for i, c := range cur.Cases {
		if c.CaseID == s.selectedCase {
			return &cur.Cases[i]
		}
	}
	if len(cur.Cases) > 0 {
		return &cur.Cases[0]
	}
	return nil
}

func renderAssertionRow(a api.QualitySuiteAssertion, width int) string {
	pass := shell.TextMuted.Render("·")
	if a.LastPass != nil {
		if *a.LastPass {
			pass = shell.Green.Render("✓")
		} else {
			pass = shell.Rose.Render("✗")
		}
	}
	op := shell.Teal.Render(padString2(a.Op, 18))
	arg := shell.TextDim.Render(truncate(a.Arg, width-26))
	return padRow(fmt.Sprintf(" %s %s %s", pass, op, arg), width)
}

func suiteName(it api.QualitySuiteRecord) string {
	if it.Name != "" {
		return it.Name
	}
	return it.SuiteID
}

// datasetStateGlyph maps each Suite lifecycle state to a glyph + color
// per the design vocabulary card. States seen in screenshot 6:
// draft · curated · pinned · live · feedback · snapshot · frozen · manual.
// Glyph + color carry the meaning at a glance; the state chip carries
// the literal label.
func datasetStateGlyph(state string) (string, lipgloss.Color) {
	switch state {
	case "draft":
		return "◇", shell.ColorAmber
	case "curated":
		return "◆", shell.ColorTeal
	case "pinned":
		return "◆", shell.ColorTeal
	case "live":
		return "●", shell.ColorGreen
	case "feedback":
		return "●", shell.ColorAmber
	case "snapshot":
		return "◌", shell.ColorTextMuted
	case "frozen":
		return "◌", shell.ColorTextMuted
	case "manual":
		return "◇", shell.ColorTextMuted
	default:
		return "·", shell.ColorTextMuted
	}
}

func jsonOrString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func parseJSONValue(raw string) any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err == nil {
		return v
	}
	return raw
}

// --- fetch -------------------------------------------------------------------

type suitesLoadedMsg []api.QualitySuiteRecord
type caseSavedMsg api.QualitySuiteRecord

func fetchSuites(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Suites(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return suitesLoadedMsg(recs)
	}
}
