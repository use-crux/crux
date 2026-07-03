package screens

import (
	"encoding/json"
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var datasetsStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

func (s *Datasets) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading datasets...")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if s.pending {
		return centerMsg(size, "dataset service pending - Phase 20 will add suite reads and case upsert.")
	}
	if len(s.suites) == 0 {
		return centerMsg(size, "no datasets yet - save from feedback or traces after Phase 20.")
	}

	rects := datasetRects(size)
	contents := [][]string{
		datasetBlockLines(s.renderDatasetList(rects[0].W, rects[0].H)),
		datasetBlockLines(s.renderCaseList(rects[1].W, rects[1].H)),
		datasetBlockLines(s.renderEditor(rects[2].W, rects[2].H)),
	}
	return strings.Join(kit.ComposeStyled(rects, contents, datasetsStyles), "\n")
}

func datasetRects(size Size) []kit.Rect {
	root := kit.Rect{W: size.Width, H: size.Height}
	switch kit.Classify(size.Width) {
	case kit.LayoutFull:
		return kit.SplitH(root, kit.Fixed(24), kit.Ratio(1, 3), kit.Fill())
	case kit.LayoutTwo:
		return kit.SplitH(root, kit.Fixed(24), kit.Fill(), kit.Fixed(0))
	default:
		return []kit.Rect{root, kit.Rect{X: root.W, W: 0, H: root.H}, kit.Rect{X: root.W, W: 0, H: root.H}}
	}
}

func (s *Datasets) renderDatasetList(width, height int) string {
	header := shell.PaneHeader(width, "Datasets", fmt.Sprintf("%d", len(s.suites)), "")
	rows := datasetBlockLines(header)
	limit := height - len(rows)
	for i, suite := range s.suites {
		if i*2+1 >= limit {
			break
		}
		rows = append(rows, s.renderSuiteRow(suite, width, suite.SuiteID == s.selectedSuite)...)
	}
	return kit.PadBlock(strings.Join(rows, "\n"), width, height)
}

func (s *Datasets) renderSuiteRow(suite api.QualitySuiteRecord, width int, selected bool) []string {
	bar := " "
	if selected {
		bar = shell.SelectionBar(shell.ColorTeal)
	}
	state := datasetStateGlyph(suite.State)
	count := shell.TextMuted.Render(fmt.Sprintf("%d", len(suite.Cases)))
	name := shell.Text.Render(kit.Truncate(firstNonEmpty(suite.Name, suite.SuiteID), width-10, "..."))
	line1 := padRow(fmt.Sprintf("%s%s %s", bar, state, name), width-lipgloss.Width(count)-1) + count
	origin := shell.TextDim.Render(firstNonEmpty(suite.Source, "local") + " · " + firstNonEmpty(suite.State, "draft"))
	return []string{padRow(line1, width), padRow("   "+origin, width)}
}

func (s *Datasets) renderCaseList(width, height int) string {
	suite := s.currentSuite()
	title := "Cases"
	subtitle := ""
	if suite != nil {
		title = kit.Truncate(firstNonEmpty(suite.Name, suite.SuiteID), maxInt(8, width-14), "...")
		subtitle = fmt.Sprintf("%d cases", len(suite.Cases))
	}
	header := shell.PaneHeader(width, title, subtitle, shell.TextDim.Render("+ add"))
	rows := datasetBlockLines(header)
	if suite != nil {
		for i, testCase := range suite.Cases {
			if len(rows)+2 > height-1 {
				break
			}
			rows = append(rows, s.renderCaseRow(testCase, width, testCase.CaseID == s.selectedCase)...)
			if i == len(suite.Cases)-1 && len(rows) < height {
				rows = append(rows, padRow("  "+shell.TextDim.Render("+ add case from trace..."), width))
			}
		}
	}
	return kit.PadBlock(strings.Join(rows, "\n"), width, height)
}

func (s *Datasets) renderCaseRow(testCase api.QualitySuiteCase, width int, selected bool) []string {
	bar := " "
	if selected {
		bar = shell.SelectionBar(shell.ColorTeal)
	}
	rating := shell.TextMuted.Render("·")
	if testCase.FeedbackRating == "negative" || testCase.FeedbackRating == "thumb-down" {
		rating = shell.Amber.Render("▲")
	}
	title := firstNonEmpty(testCase.Name, testCase.CaseID)
	line1 := fmt.Sprintf("%s%s %s  %s", bar, shell.TextMuted.Render(testCase.CaseID), shell.Text.Render(kit.Truncate(title, width-18, "...")), rating)
	tags := shell.TextDim.Render(strings.Join(testCase.Tags, " "))
	return []string{padRow(line1, width), padRow("   "+tags, width)}
}

func (s *Datasets) renderEditor(width, height int) string {
	headerRight := ""
	if s.dirty {
		headerRight = shell.Amber.Render("unsaved")
	}
	title := firstNonEmpty(s.draft.CaseID, "case")
	header := shell.PaneHeader(width, title, s.editorField.label(), headerRight)
	body := s.editorBody(width)
	footer := shell.PaneFooter(width, []shell.Keybind{
		shell.Bind("^z", "undo"),
		shell.Bind("tab", "field"),
		shell.Bind("r", "re-run pending"),
		shell.Bind("d", "duplicate"),
	})
	if s.notice != "" {
		body = append(body, "", shell.TextDim.Render(" "+s.notice))
	}
	return kit.PadBlock(header+"\n"+strings.Join(body, "\n")+"\n"+footer, width, height)
}

func (s *Datasets) editorBody(width int) []string {
	lines := []string{
		" " + fieldLabel("TAGS", s.editorField == datasetFieldTags),
		" " + renderTags(s.draft.Tags, width-2),
		"",
		" " + fieldLabel("INPUT", s.editorField == datasetFieldInput),
	}
	lines = append(lines, boxedPre(prettyAny(s.draft.Input), width-2))
	lines = append(lines, "", " "+fieldLabel("EXPECTED", s.editorField == datasetFieldExpected))
	lines = append(lines, boxedPre(prettyAny(s.draft.Expected), width-2))
	lines = append(lines, "", " "+fieldLabel("ASSERTIONS", s.editorField == datasetFieldAssertions))
	lines = append(lines, renderAssertions(s.draft.Assertions, width)...)
	lines = append(lines, "", " "+shell.SectionTag.Render("METADATA"))
	lines = append(lines, kvRow("origin", prettyAny(s.draft.Origin), width))
	if s.confirmLeave {
		lines = append(lines, shell.Amber.Render(" esc again discards local edits"))
	}
	return lines
}

func fieldLabel(label string, active bool) string {
	if active {
		return shell.TealBold.Render(label)
	}
	return shell.SectionTag.Render(label)
}

func renderTags(tags []string, width int) string {
	if len(tags) == 0 {
		return shell.TextDim.Render("+ add")
	}
	parts := make([]string, 0, len(tags))
	for _, tag := range tags {
		parts = append(parts, kit.Badge(strings.ToUpper(tag), theme.ToneBlue, datasetsStyles))
	}
	return kit.Truncate(strings.Join(parts, " "), width, "...")
}

func renderAssertions(assertions []api.QualitySuiteAssertion, width int) []string {
	if len(assertions) == 0 {
		return []string{padRow(" "+shell.TextDim.Render("no assertions yet"), width)}
	}
	out := make([]string, 0, len(assertions))
	for _, assertion := range assertions {
		status := shell.Green.Render("✓")
		if assertion.LastPass != nil && !*assertion.LastPass {
			status = shell.Rose.Render("✗")
		}
		row := fmt.Sprintf(" %s  %s  %s", status, shell.Teal.Render(assertion.Op), shell.Text.Render(assertion.Arg))
		out = append(out, padRow(row, width))
	}
	return out
}

func datasetStateGlyph(state string) string {
	switch strings.ToLower(state) {
	case "live":
		return shell.Green.Render("●")
	case "frozen":
		return shell.TextMuted.Render("○")
	case "curated", "pinned":
		return shell.Teal.Render("◆")
	default:
		return shell.Amber.Render("◇")
	}
}

func prettyAny(value any) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(data)
}

func datasetBlockLines(body string) []string {
	if body == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(body, "\n"), "\n")
}
