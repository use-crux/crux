// Package overlays implements the `:` command palette and `?` help overlay
// for the V1 Panels Workbench. Both render on top of the active screen and
// route keys through their own Update functions.
package overlays

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Command represents one palette entry.
type Command struct {
	ID    string
	Cmd   string // displayed text, e.g. ":compare baseline-014 exp-042 --gate"
	Desc  string
	Glyph string // small icon
}

// Palette is the `:` command palette overlay.
type Palette struct {
	open     bool
	input    string
	cursor   int
	commands []Command
	filtered []Command
}

// NewPalette returns a palette pre-loaded with V1 commands.
func NewPalette() *Palette {
	p := &Palette{commands: defaultCommands()}
	p.refilter()
	return p
}

// Open shows the palette and resets input.
func (p *Palette) Open() {
	p.open = true
	p.input = ""
	p.cursor = 0
	p.refilter()
}

// Close hides the palette.
func (p *Palette) Close() { p.open = false }

// IsOpen reports whether the palette is currently shown.
func (p *Palette) IsOpen() bool { return p.open }

// Update handles a key while the palette is open. Returns the chosen command
// (or empty/zero) and a tea.Cmd to run.
//
// On `enter` the chosen command is either:
//   - the highlighted result's ID + Cmd template (if the user didn't type)
//   - the literal input string parsed via ParseInput (if they did type)
//
// Callers should call ParseChosen() to get a structured Command.
func (p *Palette) Update(msg tea.KeyPressMsg) (chosen Chosen, cmd tea.Cmd) {
	switch msg.String() {
	case "esc":
		p.Close()
	case "enter":
		chosen = p.resolve()
		p.Close()
	case "tab":
		// Tab completes to the currently-highlighted entry's command text.
		if p.cursor >= 0 && p.cursor < len(p.filtered) {
			p.input = strings.TrimPrefix(p.filtered[p.cursor].Cmd, ":")
		}
	case "up", "ctrl+k":
		if p.cursor > 0 {
			p.cursor--
		}
	case "down", "ctrl+j":
		if p.cursor < len(p.filtered)-1 {
			p.cursor++
		}
	case "backspace":
		if len(p.input) > 0 {
			p.input = p.input[:len(p.input)-1]
			p.refilter()
		}
	default:
		if msg.Text != "" {
			p.input += msg.Text
			p.refilter()
		}
	}
	return chosen, nil
}

// Chosen represents the user's final palette selection.
type Chosen struct {
	ID   string   // canonical command ID when matched, else empty
	Verb string   // first token of the command (e.g. "compare", "promote")
	Args []string // remaining tokens
	Raw  string   // verbatim input
}

// resolve produces the chosen command on enter. If the user typed text, parse
// it; otherwise use the highlighted result.
func (p *Palette) resolve() Chosen {
	src := strings.TrimSpace(p.input)
	if src == "" && p.cursor >= 0 && p.cursor < len(p.filtered) {
		src = strings.TrimPrefix(p.filtered[p.cursor].Cmd, ":")
	}
	if src == "" {
		return Chosen{}
	}
	parts := strings.Fields(src)
	chosen := Chosen{Raw: src, Verb: parts[0], Args: parts[1:]}
	// Try to match a known canonical ID for the verb.
	for _, c := range p.commands {
		template := strings.TrimPrefix(c.Cmd, ":")
		head := strings.Fields(template)
		if len(head) > 0 && head[0] == chosen.Verb {
			chosen.ID = c.ID
			break
		}
	}
	return chosen
}

// View renders the content-sized palette modal.
func (p *Palette) View(viewportWidth, viewportHeight int) string {
	if !p.open {
		return ""
	}
	visible := 8
	if visible > len(p.filtered) {
		visible = len(p.filtered)
	}
	longest := len("↑↓ select  ↵ run  tab complete    8 results · 8 / 8")
	for _, command := range p.filtered[:visible] {
		longest = max(longest, lipgloss.Width(command.Cmd)+lipgloss.Width(command.Desc)+7)
	}
	size := contentModalSize(viewportWidth, viewportHeight, longest, visible, 6)
	w := size.innerWidth
	rowCapacity := max(0, size.outerHeight-6)
	visible = min(visible, rowCapacity)

	// Input row
	prompt := lipgloss.NewStyle().Foreground(shell.ColorViolet).Bold(true).Render(":")
	caret := lipgloss.NewStyle().Foreground(shell.ColorText).Background(shell.ColorText).Render(" ")
	inputValue := kit.Truncate(kit.SanitizeInline(p.input), maxInt(1, w-5), "…")
	input := lipgloss.NewStyle().Foreground(shell.ColorText).Render(inputValue)
	inputRow := " " + prompt + " " + input + caret
	if p.input == "" {
		inputRow += shell.TextMuted.Render(" type a command")
	}
	inputRow = padTo(inputRow, w)

	var rows []string
	for i := 0; i < visible; i++ {
		c := p.filtered[i]
		sel := i == p.cursor
		bar := " "
		bg := lipgloss.NoColor{}
		if sel {
			bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
		}
		glyph := lipgloss.NewStyle().Foreground(shell.ColorTeal).Render(c.Glyph)
		cmd := shell.Text.Render(c.Cmd)
		desc := shell.TextDim.Render(" " + c.Desc)
		row := bar + " " + glyph + "  " + cmd + desc
		rows = append(rows, padTo(row, w))
		_ = bg
	}
	for len(rows) < rowCapacity {
		rows = append(rows, strings.Repeat(" ", w))
	}
	// Footer hint with result counter aligned right.
	left := " " + lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(
		shell.Teal.Render("↑↓")+" select  "+
			shell.Teal.Render("↵")+" run  "+
			shell.Teal.Render("tab")+" complete",
	)
	count := ""
	if len(p.filtered) > 0 {
		count = fmt.Sprintf("%d results · %d / %d", len(p.filtered), p.cursor+1, len(p.filtered))
	} else {
		count = "no matches"
	}
	right := shell.TextMuted.Render(count) + " "
	pad := w - lipgloss.Width(left) - lipgloss.Width(right)
	if pad < 1 {
		pad = 1
	}
	hint := fitToWidth(left+strings.Repeat(" ", pad)+right, w)

	border := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorderBright).
		Border(lipgloss.RoundedBorder()).
		Render

	body := inputRow + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		strings.Join(rows, "\n") + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		hint
	return border(body)
}

func (p *Palette) refilter() {
	if p.input == "" {
		p.filtered = p.commands
		p.cursor = 0
		return
	}
	q := strings.ToLower(p.input)
	out := make([]Command, 0, len(p.commands))
	for _, c := range p.commands {
		if strings.Contains(strings.ToLower(c.Cmd), q) || strings.Contains(strings.ToLower(c.Desc), q) {
			out = append(out, c)
		}
	}
	p.filtered = out
	p.cursor = 0
}

func defaultCommands() []Command {
	commands := make([]Command, 0, len(shell.DefaultNav)+1)
	for _, item := range shell.DefaultNav {
		commands = append(commands, Command{
			ID:    "goto-" + item.ID,
			Cmd:   ":goto " + item.ID,
			Desc:  "Jump to " + item.Label,
			Glyph: "→",
		})
	}
	return append(commands, Command{ID: "quit", Cmd: ":quit", Desc: "Exit the workbench", Glyph: "✕"})
}

func padTo(s string, width int) string {
	return fitToWidth(s, width)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
