package server

import (
	"strconv"
	"strings"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func promptTextHoverSection(
	summary lsprompttext.PromptTextHover,
	format protocol.MarkupKind,
) hoverSection {
	markdown := format == protocol.MarkupKindMarkdown
	lines := make([]string, 0, 7)
	if markdown {
		lines = append(lines, "**Crux PromptText**", "")
	} else {
		lines = append(lines, "Crux PromptText", "")
	}
	if len(summary.Owners) == 1 {
		prefix := "Owner: "
		if markdown {
			prefix = "**Owner:** "
		}
		lines = append(lines, prefix+promptTextOwner(summary.Owners[0], markdown))
	} else {
		lines = append(lines, promptTextOwners(summary, markdown)...)
	}
	lines = append(lines,
		promptTextFact(
			"Template",
			formatPromptTextTemplateLabel(summary.TemplateLabel, markdown)+" · "+
				normalizeEngineText(summary.Lifecycle)+" lifecycle",
			markdown,
		),
		promptTextFact(
			"Composition",
			countLabel(summary.LiteralCount, "literal island", "literal islands")+
				" · "+
				countLabel(summary.BarrierCount, "interpolation barrier", "interpolation barriers"),
			markdown,
		),
	)
	if summary.OutgoingFragments != 0 || summary.IncomingFragments != 0 {
		lines = append(lines, promptTextFact(
			"Fragments",
			strconv.Itoa(summary.OutgoingFragments)+" outgoing · "+
				countLabel(
					summary.IncomingFragments,
					"incoming proven named-fragment edge",
					"incoming proven named-fragment edges",
				),
			markdown,
		))
	}
	lines = append(lines, promptTextFact(
		"Evidence",
		normalizeEngineText(summary.Evidence),
		markdown,
	))
	return hoverSection{content: strings.Join(lines, "\n")}
}

func promptTextOwners(
	summary lsprompttext.PromptTextHover,
	markdown bool,
) []string {
	label := "Owners:"
	if markdown {
		label = "**Owners:**"
	}
	lines := []string{label, ""}
	limit := len(summary.Owners)
	if limit > 3 {
		limit = 3
	}
	for _, owner := range summary.Owners[:limit] {
		prefix := ""
		if markdown {
			prefix = "- "
		}
		lines = append(lines, prefix+promptTextOwner(owner, markdown))
	}
	if remainder := len(summary.Owners) - limit; remainder > 0 {
		lines = append(lines, "")
		footer := "…and " + strconv.Itoa(remainder) + " more owners"
		if markdown {
			footer = "_" + footer + "_"
		}
		lines = append(lines, footer)
	}
	return lines
}

func promptTextOwner(
	owner promptview.Definition,
	markdown bool,
) string {
	name := normalizeEngineText(owner.Name)
	kind := normalizeEngineText(owner.Kind)
	id := normalizeEngineText(owner.ID)
	if markdown {
		name = escapeMarkdown(name)
		return name + " — `" + escapePromptTextCode(kind) + "` (`" +
			escapePromptTextCode(id) + "`)"
	}
	return name + " — " + kind + " (" + id + ")"
}

func promptTextFact(label, value string, markdown bool) string {
	if markdown {
		return "**" + label + ":** " + value
	}
	return label + ": " + value
}

func escapePromptTextCode(value string) string {
	return strings.ReplaceAll(value, "`", "\\`")
}

func formatPromptTextTemplateLabel(label string, markdown bool) string {
	label = normalizeEngineText(label)
	if !markdown {
		return strings.ReplaceAll(label, "`", "")
	}
	const namedPrefix = "named fragment `"
	if strings.HasPrefix(label, namedPrefix) && strings.HasSuffix(label, "`") {
		symbol := strings.TrimSuffix(strings.TrimPrefix(label, namedPrefix), "`")
		return namedPrefix + escapePromptTextCode(symbol) + "`"
	}
	return label
}
