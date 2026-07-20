package commands

import "fmt"

// devMode describes the presentation boundary used by crux dev.
type devMode string

const (
	devModePlain devMode = "plain"
	devModeTUI   devMode = "tui"
)

// devModeInput contains only the explicit capabilities and constraints that
// determine whether Bubble Tea may take ownership of the terminal.
type devModeInput struct {
	TUI       bool
	NoTUI     bool
	StdinTTY  bool
	StdoutTTY bool
	CI        bool
	Term      string
}

func resolveDevMode(input devModeInput) (devMode, error) {
	if input.TUI {
		if !input.StdinTTY || !input.StdoutTTY || input.CI || input.Term == "dumb" {
			return "", fmt.Errorf("--tui requires an interactive terminal on stdin and stdout outside CI")
		}
		return devModeTUI, nil
	}
	return selectDevMode(input), nil
}

// selectDevMode deterministically selects the interactive TUI only when both
// Bubble Tea streams are terminals and the environment permits interaction.
func selectDevMode(input devModeInput) devMode {
	if input.NoTUI || !input.StdinTTY || !input.StdoutTTY || input.CI || input.Term == "dumb" {
		return devModePlain
	}
	return devModeTUI
}
