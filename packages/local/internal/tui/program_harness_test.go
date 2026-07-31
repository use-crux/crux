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
	return runTestProgramAtSize(t, model, input, 80, 24)
}

func runTestProgramAtSize(t testing.TB, model tea.Model, input string, width, height int) (tea.Model, string, error) {
	t.Helper()

	// Full race runs execute several instrumented packages concurrently; keep
	// this a bounded hang detector without making normal scheduler contention
	// look like a program deadlock.
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	var output bytes.Buffer
	program := tea.NewProgram(
		model,
		tea.WithContext(ctx),
		tea.WithInput(strings.NewReader(input)),
		tea.WithOutput(&output),
		tea.WithEnvironment([]string{"NO_COLOR=1", "TERM=dumb"}),
		tea.WithWindowSize(width, height),
		tea.WithoutSignalHandler(),
	)
	final, err := program.Run()
	return final, output.String(), err
}
