package screens

import (
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/tui/shell"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Stub is a placeholder screen used until each Quality screen is filled in.
// It renders the title + a "coming soon" hint so the nav rail can still
// route to every section and users can see what's planned.
type Stub struct {
	id       string
	title    string
	subtitle string
}

func NewStub(id, title, subtitle string) *Stub {
	return &Stub{id: id, title: title, subtitle: subtitle}
}

func (s *Stub) ID() string                                { return s.id }
func (s *Stub) Init(_ DataClient) tea.Cmd                 { return nil }
func (s *Stub) Update(_ tea.Msg, _ DataClient) tea.Cmd    { return nil }
func (s *Stub) Counts() map[string]int                    { return nil }
func (s *Stub) Breadcrumb() ([]string, string)            { return []string{s.id}, "" }
func (s *Stub) Keybinds() []shell.Keybind                 { return nil }

func (s *Stub) View(size Size) string {
	title := lipgloss.NewStyle().Foreground(shell.ColorText).Bold(true).Render(s.title)
	sub := shell.TextMuted.Render(s.subtitle)
	body := strings.Repeat("\n", size.Height/2-1) +
		centerStr(title, size.Width) + "\n" +
		centerStr(sub, size.Width) + "\n\n" +
		centerStr(shell.TextMuted.Render(fmt.Sprintf("[screen %q · not yet implemented]", s.id)), size.Width)
	return body
}
