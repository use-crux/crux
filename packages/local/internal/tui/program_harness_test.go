package tui

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

func runTestProgram(t testing.TB, model tea.Model, input string) (tea.Model, string, error) {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()

	var output bytes.Buffer
	program := tea.NewProgram(
		model,
		tea.WithContext(ctx),
		tea.WithInput(strings.NewReader(input)),
		tea.WithOutput(&output),
		tea.WithEnvironment([]string{"NO_COLOR=1", "TERM=dumb"}),
		tea.WithWindowSize(80, 24),
		tea.WithoutSignalHandler(),
	)
	final, err := program.Run()
	return final, output.String(), err
}
