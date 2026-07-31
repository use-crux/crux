package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// definitionChooser is the Workbench-owned modal state for selecting one
// exact runtime definition destination. It never queries Project Index.
type definitionChooser struct {
	open          bool
	choices       []screens.DefinitionChoice
	list          *kit.ListPane[screens.DefinitionChoice]
	metadata      *kit.DocumentPane
	metadataFocus bool
	width         int
	height        int
}

func newDefinitionChooser() *definitionChooser {
	list := kit.NewListPane(func(choice screens.DefinitionChoice) string { return choice.ID })
	list.SetFocused(true)
	list.SetRowHeight(func(screens.DefinitionChoice) int { return 1 })
	return &definitionChooser{list: list, metadata: kit.NewDocumentPane()}
}

func (c *definitionChooser) Open(choices []screens.DefinitionChoice) {
	c.choices = cloneDefinitionChoices(choices)
	c.list.SetItems(c.choices)
	c.open = len(c.choices) > 0
	c.metadataFocus = false
	c.list.SetFocused(true)
	c.metadata.SetFocused(false)
	c.syncMetadata()
	c.resizeList()
}

func (c *definitionChooser) Close() {
	c.open = false
	c.choices = nil
	c.list.SetItems(nil)
	c.metadata.SetContent("", "")
}

func (c *definitionChooser) IsOpen() bool { return c != nil && c.open }

func (c *definitionChooser) Resize(width, height int) {
	c.width, c.height = max(0, width), max(0, height)
	c.resizeList()
}

func (c *definitionChooser) resizeList() {
	innerWidth, innerHeight := c.innerSize()
	listHeight := min(5, max(1, (innerHeight-5)/3))
	metadataHeight := max(1, innerHeight-5-listHeight)
	c.list.SetSize(innerWidth, listHeight)
	c.metadata.SetSize(innerWidth, metadataHeight)
}

func (c *definitionChooser) innerSize() (int, int) {
	width := min(88, max(1, c.width-2))
	height := min(22, max(1, c.height-4))
	return width, height
}

func (c *definitionChooser) SelectedID() string {
	choice, _, ok := c.list.Selected()
	if !ok {
		return ""
	}
	return choice.ID
}

func (c *definitionChooser) Position() kit.ListPosition { return c.list.Position() }

func (c *definitionChooser) Update(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		c.Close()
		return nil
	case "enter":
		id := c.SelectedID()
		c.Close()
		if id == "" {
			return nil
		}
		return func() tea.Msg {
			return screens.NavigateRequest{NavID: "index", Kind: "definition", ID: id}
		}
	case "tab":
		c.metadataFocus = !c.metadataFocus
		c.list.SetFocused(!c.metadataFocus)
		c.metadata.SetFocused(c.metadataFocus)
		return nil
	default:
		if c.metadataFocus {
			c.metadata.Update(msg)
			return nil
		}
		selected := c.SelectedID()
		c.list.Update(msg)
		if selected != c.SelectedID() {
			c.syncMetadata()
		}
		return nil
	}
}

func (c *definitionChooser) View() string {
	if !c.IsOpen() {
		return ""
	}
	width, height := c.innerSize()
	position := c.list.Position()
	focus := "choices"
	if c.metadataFocus {
		focus = "details"
	}
	header := chooserFit(fmt.Sprintf(" %s  %d choices · %s", shell.TealBold.Render("open definition"), position.Total, focus), width)
	rule := lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", width))
	listHeight := min(5, max(1, (height-5)/3))
	body := c.list.Render(renderDefinitionChoice)
	for len(body) < listHeight {
		body = append(body, strings.Repeat(" ", width))
	}
	detailPosition := c.metadata.Position()
	detailHeader := chooserFit(fmt.Sprintf(" details · %d-%d/%d", detailPosition.FirstLine, detailPosition.LastLine, detailPosition.TotalLines), width)
	details := c.metadata.Render()
	footer := chooserFit(fmt.Sprintf(" j/k move · pgup/pgdn page · home/end · tab %s · enter · esc   %d/%d",
		map[bool]string{false: "details", true: "choices"}[c.metadataFocus], position.SelectedIndex+1, position.Total), width)
	lines := append([]string{header, rule}, body...)
	lines = append(lines, detailHeader)
	lines = append(lines, details...)
	lines = append(lines, rule, footer)
	inner := strings.Join(lines, "\n")
	return lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorder).
		Border(lipgloss.RoundedBorder()).
		Render(inner)
}

func renderDefinitionChoice(choice screens.DefinitionChoice, _ int, selected bool, width int) string {
	marker := "  "
	if selected {
		marker = shell.SelectionBar(shell.ColorTeal) + " "
	}
	return chooserFit(marker+sanitizeChooserInline(choice.ID), width)
}

func (c *definitionChooser) syncMetadata() {
	choice, _, ok := c.list.Selected()
	if !ok {
		c.metadata.SetContent("", "")
		return
	}
	lines := []string{"exact ID", sanitizeChooserInline(choice.ID), "", "runtime references"}
	if len(choice.References) == 0 {
		lines = append(lines, "metadata unavailable")
	}
	for index, ref := range choice.References {
		lines = append(lines, fmt.Sprintf("%d. %s", index+1, definitionReferenceMetadata(ref)))
	}
	c.metadata.SetContent(choice.ID, strings.Join(lines, "\n"))
}

func definitionReferenceMetadata(ref observability.DefinitionRef) string {
	parts := make([]string, 0, 3)
	for _, value := range []string{ref.Kind, ref.Role} {
		if safe := sanitizeChooserInline(value); safe != "" {
			parts = append(parts, safe)
		}
	}
	if ref.Source != nil && ref.Source.File != "" {
		source := fmt.Sprintf("%s:%d", sanitizeChooserInline(ref.Source.File), ref.Source.Line)
		if ref.Source.Column > 0 {
			source += fmt.Sprintf(":%d", ref.Source.Column)
		}
		parts = append(parts, source)
	}
	if len(parts) == 0 {
		return "metadata unavailable"
	}
	return strings.Join(parts, " · ")
}

func sanitizeChooserInline(value string) string {
	return strings.Join(strings.Fields(kit.SanitizeInline(value)), " ")
}

func chooserFit(value string, width int) string {
	if width <= 0 {
		return ""
	}
	value = kit.Truncate(value, width, "…")
	if cells := lipgloss.Width(value); cells < width {
		value += strings.Repeat(" ", width-cells)
	}
	return value
}

func cloneDefinitionChoices(choices []screens.DefinitionChoice) []screens.DefinitionChoice {
	cloned := make([]screens.DefinitionChoice, len(choices))
	for index, choice := range choices {
		cloned[index] = choice
		cloned[index].References = append([]observability.DefinitionRef(nil), choice.References...)
	}
	return cloned
}
