package promptlatest

type availabilityPort interface {
	HasPromptPreviewTarget(string) bool
}
