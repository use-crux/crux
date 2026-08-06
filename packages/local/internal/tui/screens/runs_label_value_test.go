package screens

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestDiagnosisLabelValueWrapUsesHangingIndent(t *testing.T) {
	const width = 28
	rendered := stripANSI(kvRow("error", "Account service timed out while loading the customer record", width))
	lines := strings.Split(strings.TrimRight(rendered, "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("test value did not wrap:\n%s", rendered)
	}
	for index, line := range lines {
		if got := lipgloss.Width(line); got != width {
			t.Fatalf("line %d width = %d, want %d:\n%s", index+1, got, width, rendered)
		}
		if index > 0 && !strings.HasPrefix(line, strings.Repeat(" ", 16)) {
			t.Fatalf("continuation line %d did not align to value column:\n%s", index+1, rendered)
		}
	}
}
