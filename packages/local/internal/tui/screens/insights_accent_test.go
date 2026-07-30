package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestInsightsSelectedCategoryUsesVioletAccent(t *testing.T) {
	screen := NewInsights()
	insight := api.InspectInsightRecord{
		Title:          "Run is slow",
		Tags:           []string{"Latency"},
		LinkedTraceIDs: []string{"trace-1"},
	}

	selected, _ := screen.renderListRow(insight, 70, true)
	_, selectedMeta := screen.renderListRow(insight, 70, true)
	if !strings.Contains(selectedMeta, shell.Violet.Render("Latency")) {
		t.Fatalf("selected category was not violet:\n%s\n%s", selected, selectedMeta)
	}
	_, unselectedMeta := screen.renderListRow(insight, 70, false)
	if strings.Contains(unselectedMeta, shell.Violet.Render("Latency")) {
		t.Fatalf("unselected category retained violet accent:\n%s", unselectedMeta)
	}
	if !strings.Contains(stripANSI(selectedMeta), "1 trace") {
		t.Fatalf("selected metadata was not singularized:\n%s", stripANSI(selectedMeta))
	}
}
