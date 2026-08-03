package evalcmd

import (
	"slices"
	"testing"
)

func TestCoordinatorEnvironmentRemovesForceColorWhenNoColorIsPresent(t *testing.T) {
	got := coordinatorEnvironment([]string{
		"PATH=/bin",
		"NO_COLOR=1",
		"FORCE_COLOR=3",
	})
	if slices.Contains(got, "FORCE_COLOR=3") {
		t.Fatalf("environment retained conflicting FORCE_COLOR: %#v", got)
	}
	if !slices.Contains(got, "NO_COLOR=1") {
		t.Fatalf("environment removed NO_COLOR: %#v", got)
	}
}

func TestCoordinatorEnvironmentKeepsForceColorWithoutNoColor(t *testing.T) {
	environment := []string{"PATH=/bin", "FORCE_COLOR=3"}
	got := coordinatorEnvironment(environment)
	if !slices.Equal(got, environment) {
		t.Fatalf("environment = %#v, want %#v", got, environment)
	}
}
