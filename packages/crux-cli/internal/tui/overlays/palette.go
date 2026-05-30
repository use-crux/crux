// Package overlays implements the `:` command palette and `?` help overlay
// for the V1 Panels Workbench. Both render on top of the active screen and
// route keys through their own Update functions.
package overlays

import (
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/tui/shell"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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
func (p *Palette) Update(msg tea.KeyMsg) (chosen Chosen, cmd tea.Cmd) {
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
		if len(msg.String()) == 1 && msg.String()[0] >= 0x20 {
			p.input += msg.String()
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

// View renders the palette modal. Caller must overlay this onto the body
// screen; this function returns the modal block sized to roughly 64×~14.
func (p *Palette) View(viewportWidth, viewportHeight int) string {
	if !p.open {
		return ""
	}
	w := 64
	if w > viewportWidth-4 {
		w = viewportWidth - 4
	}
	visible := 8
	if visible > len(p.filtered) {
		visible = len(p.filtered)
	}

	// Input row
	prompt := lipgloss.NewStyle().Foreground(shell.ColorViolet).Bold(true).Render(":")
	input := lipgloss.NewStyle().Foreground(shell.ColorText).Render(p.input)
	caret := lipgloss.NewStyle().Foreground(shell.ColorText).Background(shell.ColorText).Render(" ")
	inputRow := " " + prompt + " " + input + caret +
		strings.Repeat(" ", maxInt(1, w-lipgloss.Width(p.input)-6)) +
		lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render("cmd")
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
	// Footer hint with result counter aligned right.
	left := " " + lipgloss.NewStyle().Foreground(shell.ColorTextMuted).Render(
		shell.Teal.Render("↑↓")+" select  "+
			shell.Teal.Render("↵")+" run  "+
			shell.Teal.Render("tab")+" complete  "+
			shell.Teal.Render("^r")+" history",
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
	hint := left + strings.Repeat(" ", pad) + right

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
	return []Command{
		{ID: "compare", Cmd: ":compare baseline-014 exp-042 --gate", Desc: "Compare two experiments with regression gate", Glyph: "⇆"},
		{ID: "promote", Cmd: ":promote exp-043:winner", Desc: "Promote variant to baseline", Glyph: "★"},
		{ID: "run", Cmd: ":run docs_agent --dataset agent-loops", Desc: "Run a flow against a dataset", Glyph: "▶"},
		{ID: "open-trace", Cmd: ":open trace 8af2", Desc: "Open a trace by id prefix", Glyph: "◐"},
		{ID: "save-insight", Cmd: ":save insight INS-014 --as-cases", Desc: "Save linked failures as dataset cases", Glyph: "◇"},
		{ID: "cassette-record", Cmd: ":cassette record fixtures/triage", Desc: "Switch a cassette to record mode", Glyph: "▣"},
		{ID: "target", Cmd: ":target docs_agent@gpt-5", Desc: "Set the workbench target", Glyph: "⌖"},
		{ID: "baseline-pin", Cmd: ":baseline pin exp-043", Desc: "Pin a baseline for this project", Glyph: "◎"},
		{ID: "goto-overview", Cmd: ":goto overview", Desc: "Jump to Overview", Glyph: "→"},
		{ID: "goto-insights", Cmd: ":goto insights", Desc: "Jump to Insights", Glyph: "→"},
		{ID: "goto-runs", Cmd: ":goto runs", Desc: "Jump to Runs", Glyph: "→"},
		{ID: "quit", Cmd: ":quit", Desc: "Exit the workbench", Glyph: "✕"},
	}
}

func padTo(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
