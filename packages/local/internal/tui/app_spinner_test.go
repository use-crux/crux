package tui

import (
	"testing"

	"charm.land/bubbles/v2/spinner"
)

func TestAppStopsBootSpinnerAfterBootCompletes(t *testing.T) {
	app := NewApp(t.Context(), "http://localhost:5501", newSlowIndexFixtureClient(), "", false)
	app.MarkBootComplete()

	_, cmd := app.Update(spinner.TickMsg{})
	if cmd != nil {
		t.Fatal("post-boot spinner tick scheduled another render")
	}
}
