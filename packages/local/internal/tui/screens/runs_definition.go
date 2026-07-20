package screens

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

// DefinitionChoice is one exact Project Index destination and all runtime
// metadata observed for that ID. References retain backend order.
type DefinitionChoice struct {
	ID         string
	References []observability.DefinitionRef
}

// ChooseDefinitionRequest asks the Workbench to present a modal choice among
// exact runtime destinations. Opening the chooser does not navigate or add
// history; the Workbench emits the selected route only after confirmation.
type ChooseDefinitionRequest struct {
	Choices []DefinitionChoice
}

func (s *Runs) definitionChoices() []DefinitionChoice {
	var refs []observability.DefinitionRef
	if s.focus == focusRuns {
		if s.diagnosis != nil {
			refs = s.diagnosis.DefinitionRefs
		}
	} else if activity := s.currentActivity(); activity != nil {
		refs = append(refs, activity.DefinitionRefs...)
		for _, detail := range activity.Details {
			refs = append(refs, detail.DefinitionRefs...)
		}
	}
	return distinctDefinitionChoices(refs)
}

func distinctDefinitionChoices(refs []observability.DefinitionRef) []DefinitionChoice {
	choices := make([]DefinitionChoice, 0, len(refs))
	positions := make(map[string]int, len(refs))
	for _, ref := range refs {
		if ref.ID == "" {
			continue
		}
		if position, ok := positions[ref.ID]; ok {
			choices[position].References = append(choices[position].References, ref)
			continue
		}
		positions[ref.ID] = len(choices)
		choices = append(choices, DefinitionChoice{ID: ref.ID, References: []observability.DefinitionRef{ref}})
	}
	return choices
}

func (s *Runs) openDefinition() tea.Cmd {
	choices := s.definitionChoices()
	if len(choices) == 0 {
		return nil
	}
	if len(choices) == 1 {
		choice := choices[0]
		return func() tea.Msg {
			return NavigateRequest{NavID: "index", Kind: "definition", ID: choice.ID}
		}
	}
	return func() tea.Msg { return ChooseDefinitionRequest{Choices: choices} }
}
