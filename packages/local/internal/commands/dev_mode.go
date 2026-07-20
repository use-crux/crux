package commands

// devMode describes the presentation boundary used by crux dev.
type devMode string

const (
	devModePlain devMode = "plain"
	devModeTUI   devMode = "tui"
)

// devModeInput contains only the explicit capabilities and constraints that
// determine whether Bubble Tea may take ownership of the terminal.
type devModeInput struct {
	NoTUI     bool
	StdinTTY  bool
	StdoutTTY bool
	CI        bool
	Term      string
}

// selectDevMode deterministically selects the interactive TUI only when both
// Bubble Tea streams are terminals and the environment permits interaction.
func selectDevMode(input devModeInput) devMode {
	if input.NoTUI || !input.StdinTTY || !input.StdoutTTY || input.CI || input.Term == "dumb" {
		return devModePlain
	}
	return devModeTUI
}
