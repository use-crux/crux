package promptlatest

import "github.com/use-crux/crux/packages/local/internal/store"

type indexPort interface {
	CaptureProjectIndex() store.ProjectIndexCapture
}

func currentPromptOwner(
	capture store.ProjectIndexCapture,
	definitionID string,
) UnavailableReason {
	var match *store.ProjectDefinition
	for index := range capture.Index.Definitions {
		definition := &capture.Index.Definitions[index]
		if definition.ID != definitionID {
			continue
		}
		if match != nil {
			return ReasonOwnerNotFound
		}
		match = definition
	}
	if match == nil {
		return ReasonOwnerNotFound
	}
	if match.Kind != "prompt" {
		return ReasonOwnerNotPrompt
	}
	return ""
}
