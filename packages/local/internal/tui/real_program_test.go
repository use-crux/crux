package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

type realProgramSmokeModel struct {
	initialized bool
	key         string
}

func (m *realProgramSmokeModel) Init() tea.Cmd {
	m.initialized = true
	return nil
}

func (m *realProgramSmokeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := msg.(tea.KeyPressMsg); ok {
		m.key = key.String()
		return m, tea.Quit
	}
	return m, nil
}

func (m *realProgramSmokeModel) View() tea.View {
	return tea.NewView("program ready")
}

func TestRealProgramHarnessBootsAndExits(t *testing.T) {
	final, output, err := runTestProgram(t, &realProgramSmokeModel{}, "x")
	if err != nil {
		t.Fatalf("run real program: %v", err)
	}

	model, ok := final.(*realProgramSmokeModel)
	if !ok {
		t.Fatalf("final model type = %T, want *realProgramSmokeModel", final)
	}
	if !model.initialized {
		t.Fatal("program did not initialize model")
	}
	if model.key != "x" {
		t.Fatalf("program key = %q, want controlled input %q", model.key, "x")
	}
	if !strings.Contains(output, "program ready") {
		t.Fatalf("program output = %q, want rendered view", output)
	}
}
