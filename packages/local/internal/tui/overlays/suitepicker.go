package overlays

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// SuitePicker is a modal that lets the user pick one Suite from a
// (fuzzy-filterable) list. It is reused by every screen that has an
// `s save-as-case` affordance — Runs, Compare, Feedback, Insights —
// because the case-capture flow always lands the new Case inside some
// Suite the user must choose.
//
// The picker is screen-owned (each screen that uses it embeds a *SuitePicker)
// rather than workbench-owned, because the data (the suite list) varies
// per opening and the confirmation is consumed by the opener.
type SuitePicker struct {
	open      bool
	suites    []api.QualitySuiteRecord
	cursor    int
	filter    string
	confirmed string // non-empty after the user pressed Enter
	hasResult bool
}

// NewSuitePicker constructs an empty (closed) picker.
func NewSuitePicker() *SuitePicker { return &SuitePicker{} }

// Open shows the picker over the given suite list. Resets cursor and
// any prior filter/confirmation.
func (p *SuitePicker) Open(suites []api.QualitySuiteRecord) {
	p.open = true
	p.suites = suites
	p.cursor = 0
	p.filter = ""
	p.confirmed = ""
	p.hasResult = false
}

// Close hides the picker without recording a confirmation.
func (p *SuitePicker) Close() {
	p.open = false
}

// IsOpen reports whether the picker is currently shown.
func (p *SuitePicker) IsOpen() bool { return p.open }

// Confirmed returns the suite id the user picked and `true` iff the
// last Open()→Enter cycle produced a confirmation. Esc-cancel and
// fresh Opens reset this to ("", false).
func (p *SuitePicker) Confirmed() (string, bool) {
	if !p.hasResult {
		return "", false
	}
	return p.confirmed, true
}

// VisibleCount reports the number of suites that pass the current
// filter. Used by tests + the footer counter in View().
func (p *SuitePicker) VisibleCount() int {
	return len(p.visible())
}

// SelectedSuiteID returns the suite id of the cursor-focused row in
// the current filtered list, or "" if the list is empty.
func (p *SuitePicker) SelectedSuiteID() string {
	v := p.visible()
	if p.cursor < 0 || p.cursor >= len(v) {
		return ""
	}
	return v[p.cursor].SuiteID
}

// Update handles a key while the picker is open. Caller routes keys
// here when IsOpen() is true.
func (p *SuitePicker) Update(msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		p.hasResult = false
		p.confirmed = ""
		p.Close()
	case "enter":
		if id := p.SelectedSuiteID(); id != "" {
			p.confirmed = id
			p.hasResult = true
		}
		p.Close()
	case "j", "down":
		p.move(+1)
	case "k", "up":
		p.move(-1)
	case "backspace":
		if len(p.filter) > 0 {
			p.filter = p.filter[:len(p.filter)-1]
			p.cursor = 0
		}
	default:
		s := msg.String()
		if len(s) == 1 && s[0] >= 0x20 {
			p.filter += s
			p.cursor = 0
		}
	}
	return nil
}

func (p *SuitePicker) move(delta int) {
	n := len(p.visible())
	if n == 0 {
		return
	}
	next := p.cursor + delta
	if next < 0 {
		next = 0
	}
	if next >= n {
		next = n - 1
	}
	p.cursor = next
}

func (p *SuitePicker) visible() []api.QualitySuiteRecord {
	if p.filter == "" {
		return p.suites
	}
	q := strings.ToLower(p.filter)
	out := make([]api.QualitySuiteRecord, 0, len(p.suites))
	for _, s := range p.suites {
		hay := strings.ToLower(s.SuiteID + " " + s.Name)
		if strings.Contains(hay, q) {
			out = append(out, s)
		}
	}
	return out
}

// View renders the modal. Caller composites it onto the screen body.
func (p *SuitePicker) View(viewportWidth, viewportHeight int) string {
	if !p.open {
		return ""
	}
	w := 56
	if w > viewportWidth-4 {
		w = viewportWidth - 4
	}

	prompt := lipgloss.NewStyle().Foreground(shell.ColorTeal).Bold(true).Render("save as case → suite")
	header := " " + prompt + "  " +
		shell.TextMuted.Render("type to filter · ↵ confirm · esc cancel")
	header = padTo(header, w)

	input := lipgloss.NewStyle().Foreground(shell.ColorText).Render("> " + p.filter)
	inputRow := " " + input
	inputRow = padTo(inputRow, w)

	visible := p.visible()
	maxRows := 8
	if maxRows > len(visible) {
		maxRows = len(visible)
	}

	var rows []string
	for i := 0; i < maxRows; i++ {
		s := visible[i]
		bar := "  "
		if i == p.cursor {
			bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌ ")
		}
		label := s.SuiteID
		if s.Name != "" {
			label = s.SuiteID + "  " + shell.TextDim.Render(s.Name)
		}
		rows = append(rows, padTo(bar+label, w))
	}
	if len(visible) == 0 {
		rows = append(rows, padTo(" "+shell.TextMuted.Render("no matches"), w))
	}

	counter := shell.TextMuted.Render("")
	if len(p.suites) > 0 {
		counter = shell.TextMuted.Render(
			intToStr(len(visible)) + " of " + intToStr(len(p.suites)) + " suites",
		)
	}
	footer := padTo(" "+counter, w)

	border := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		BorderForeground(shell.ColorBorderBright).
		Border(lipgloss.RoundedBorder()).
		Render

	body := header + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		inputRow + "\n" +
		strings.Join(rows, "\n") + "\n" +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", w)) + "\n" +
		footer
	return border(body)
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	out := ""
	for n > 0 {
		out = string(rune('0'+n%10)) + out
		n /= 10
	}
	if neg {
		out = "-" + out
	}
	return out
}
