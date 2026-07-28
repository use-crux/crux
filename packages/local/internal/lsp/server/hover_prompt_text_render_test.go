package server

import (
	"strings"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextHoverRendersCanonicalMarkdownAndPlaintext(t *testing.T) {
	summary := lsprompttext.PromptTextHover{
		Handled: true, Claimed: true,
		Range: protocol.Range{
			Start: protocol.Position{Line: 4, Character: 10},
			End:   protocol.Position{Line: 4, Character: 15},
		},
		Owners: []promptview.Definition{{
			ID: "prompt:writer", Name: "Writer", Kind: "prompt",
		}},
		TemplateLabel: "direct `prompt` template",
		Lifecycle:     "static", LiteralCount: 2, BarrierCount: 1,
		OutgoingFragments: 1, IncomingFragments: 2,
		Evidence: "saved semantic fallback; current syntax matched",
	}
	tests := []struct {
		format protocol.MarkupKind
		want   string
	}{
		{
			format: protocol.MarkupKindMarkdown,
			want: "**Crux PromptText**\n\n" +
				"**Owner:** Writer — `prompt` (`prompt:writer`)\n" +
				"**Template:** direct `prompt` template · static lifecycle\n" +
				"**Composition:** 2 literal islands · 1 interpolation barrier\n" +
				"**Fragments:** 1 outgoing · 2 incoming proven named-fragment edges\n" +
				"**Evidence:** saved semantic fallback; current syntax matched",
		},
		{
			format: protocol.MarkupKindPlainText,
			want: "Crux PromptText\n\n" +
				"Owner: Writer — prompt (prompt:writer)\n" +
				"Template: direct prompt template · static lifecycle\n" +
				"Composition: 2 literal islands · 1 interpolation barrier\n" +
				"Fragments: 1 outgoing · 2 incoming proven named-fragment edges\n" +
				"Evidence: saved semantic fallback; current syntax matched",
		},
	}
	for _, test := range tests {
		t.Run(string(test.format), func(t *testing.T) {
			hover := buildHoverWithPromptText(nil, nil, &summary, test.format)
			if hover.Contents.Value != test.want || hover.Range == nil ||
				*hover.Range != summary.Range {
				t.Fatalf("hover = %#v, want %q", hover, test.want)
			}
		})
	}
}

func TestPromptTextHoverCapsSharedOwnersAndUTF16Output(t *testing.T) {
	owners := make([]promptview.Definition, 0, 5)
	for index, id := range []string{"a", "b", "c", "d", "e"} {
		owners = append(owners, promptview.Definition{
			ID: "prompt:" + id, Kind: "prompt",
			Name: "Owner " + string(rune('A'+index)),
		})
	}
	summary := lsprompttext.PromptTextHover{
		Handled: true, Claimed: true, Owners: owners,
		TemplateLabel: "direct `prompt` template",
		Lifecycle:     "static", LiteralCount: 1,
		Evidence: "exact semantic view",
	}

	hover := buildHoverWithPromptText(
		nil,
		nil,
		&summary,
		protocol.MarkupKindMarkdown,
	)

	if strings.Contains(hover.Contents.Value, "prompt:d") ||
		strings.Contains(hover.Contents.Value, "prompt:e") ||
		!strings.Contains(hover.Contents.Value, "…and 2 more owners") {
		t.Fatalf("bounded shared hover = %q", hover.Contents.Value)
	}

	summary.Owners[0].Name = strings.Repeat("😀", 3_000)
	hover = buildHoverWithPromptText(
		nil,
		nil,
		&summary,
		protocol.MarkupKindMarkdown,
	)
	if utf16Units(hover.Contents.Value) > maxHoverUTF16Units {
		t.Fatalf("shared hover exceeded UTF-16 cap: %d", utf16Units(hover.Contents.Value))
	}
}
