package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBuildHoverMatchesMarkupGoldens(t *testing.T) {
	t.Parallel()

	full := fullHoverFinding()
	equalMessage := hoverFinding("equal", "Repeated title")
	equalMessage.Finding.Message = equalMessage.Finding.Title
	emptyMessage := hoverFinding("empty", "Empty message")
	emptyMessage.Finding.Rationale = "Rationale remains visible."
	escaped := hoverFinding("escaped", "`code` [x](y) <script>")
	escaped.Finding.Message = "`instance`\n[x](y)"
	escaped.Finding.Rationale = "<script> | # heading"
	escaped.Finding.Impact = "*boom* _now_"
	escaped.Finding.Suppressed = true
	escaped.Finding.SuppressedBy = &api.IndexLintSuppressedBy{
		Reason: "[legacy](client)",
		Source: &api.SourceLoc{File: "src/<writer>.ts", Line: 7},
	}

	tests := []struct {
		name    string
		finding displayedFinding
		format  protocol.MarkupKind
		golden  string
	}{
		{name: "full markdown", finding: full, format: protocol.MarkupKindMarkdown, golden: "hover-full.md"},
		{name: "message equals title", finding: equalMessage, format: protocol.MarkupKindMarkdown, golden: "hover-message-equal.md"},
		{name: "empty message", finding: emptyMessage, format: protocol.MarkupKindMarkdown, golden: "hover-message-empty.md"},
		{name: "escaped markdown", finding: escaped, format: protocol.MarkupKindMarkdown, golden: "hover-escaped.md"},
		{name: "plaintext", finding: full, format: protocol.MarkupKindPlainText, golden: "hover-full.txt"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hover := buildHover([]displayedFinding{test.finding}, test.format)
			want, err := os.ReadFile(filepath.Join("testdata", test.golden))
			if err != nil {
				t.Fatal(err)
			}
			wantValue := strings.TrimSuffix(string(want), "\n")
			if hover.Contents.Kind != test.format || hover.Contents.Value != wantValue {
				t.Fatalf("hover mismatch\n--- got ---\n%s\n--- want ---\n%s", hover.Contents.Value, want)
			}
			if hover.Range == nil || *hover.Range != test.finding.Diagnostic.Range {
				t.Fatalf("hover range = %#v, want %#v", hover.Range, test.finding.Diagnostic.Range)
			}
		})
	}
}

func TestBuildHoverRendersThreeDeterministicFindingsAndOverflowCount(t *testing.T) {
	t.Parallel()

	findings := []displayedFinding{
		hoverFinding("delta", "Delta"),
		hoverFinding("bravo", "Bravo"),
		hoverFinding("echo", "Echo"),
		hoverFinding("alpha", "Alpha"),
		hoverFinding("charlie", "Charlie"),
	}
	for index := range findings {
		findings[index].Diagnostic.Range = protocol.Range{
			Start: protocol.Position{Line: 2, Character: 4},
			End:   protocol.Position{Line: 2, Character: 9},
		}
	}
	hover := buildHover(findings, protocol.MarkupKindMarkdown)
	wantOrder := []string{"**Alpha**", "**Bravo**", "**Charlie**"}
	last := -1
	for _, value := range wantOrder {
		index := strings.Index(hover.Contents.Value, value)
		if index <= last {
			t.Fatalf("hover order/value = %q, want %v in order", hover.Contents.Value, wantOrder)
		}
		last = index
	}
	if strings.Contains(hover.Contents.Value, "**Delta**") || strings.Contains(hover.Contents.Value, "**Echo**") {
		t.Fatalf("hover rendered more than three findings: %q", hover.Contents.Value)
	}
	if !strings.HasSuffix(hover.Contents.Value, "*…and 2 more Crux findings on this line*") {
		t.Fatalf("hover overflow footer = %q", hover.Contents.Value)
	}
}

func TestBuildHoverCapsTotalUTF16WithoutBreakingLinkTarget(t *testing.T) {
	t.Parallel()

	finding := hoverFinding("long", "Long finding")
	finding.Finding.Rationale = strings.Repeat("😀", 3_000)
	finding.Finding.DocsURL = "https://example.com/" + strings.Repeat("segment", 800)
	hover := buildHover([]displayedFinding{finding}, protocol.MarkupKindMarkdown)
	if got := utf16Units(hover.Contents.Value); got > maxHoverUTF16Units || got < maxHoverUTF16Units-1 {
		t.Fatalf("hover UTF-16 units = %d, want a whole-rune value at the %d-unit cap", got, maxHoverUTF16Units)
	}
	if !utf8.ValidString(hover.Contents.Value) || !strings.HasSuffix(hover.Contents.Value, "…") {
		t.Fatalf("truncated hover is invalid or lacks ellipsis: %q", hover.Contents.Value[len(hover.Contents.Value)-20:])
	}
	if strings.Contains(hover.Contents.Value, "Rule documentation") || strings.Contains(hover.Contents.Value, "](https://") {
		t.Fatalf("hover truncated inside or emitted an over-budget link: %q", hover.Contents.Value[len(hover.Contents.Value)-80:])
	}
}

func fullHoverFinding() displayedFinding {
	finding := hoverFinding("runtime.unsafe_output", "Unsafe output")
	finding.Finding.Severity = "warning"
	finding.Finding.Maturity = "experimental"
	finding.Finding.Confidence = "high"
	finding.Finding.Message = `agent "writer" exposes unsafe output.`
	finding.Finding.Rationale = "Runtime consumers need a stable contract."
	finding.Finding.Impact = "Responses may fail validation."
	finding.Finding.DocsURL = "/docs/rules/runtime-unsafe-output"
	finding.Finding.Suppressed = true
	finding.Finding.SuppressedBy = &api.IndexLintSuppressedBy{
		Reason: "legacy client",
		Source: &api.SourceLoc{File: "src/writer.ts", Line: 12},
	}
	return finding
}

func hoverFinding(id, title string) displayedFinding {
	diagnosticRange := protocol.Range{
		Start: protocol.Position{Line: 2, Character: 4},
		End:   protocol.Position{Line: 2, Character: 9},
	}
	return displayedFinding{
		Diagnostic: protocol.Diagnostic{Range: diagnosticRange, Source: "crux"},
		Finding: api.IndexLintFinding{
			ID: id, RuleID: id, Severity: "info", Title: title,
		},
	}
}
