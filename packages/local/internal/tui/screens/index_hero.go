package screens

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (b *indexDocumentBuilder) renderHero() {
	switch {
	case b.definition.Kind == "agent":
		b.renderAgentHero()
	case b.definition.Kind == "flow":
		b.renderFlowHero()
	case isRoutingDefinition(b.definition.Kind):
		b.renderRoutingHero()
	}
}

func (b *indexDocumentBuilder) renderAgentHero() {
	_, outgoing := indexRelations(b.index, b.definition.ID)
	var prompts, tools, handoffs []string
	for _, ref := range outgoing {
		switch ref.relation.Type {
		case "agent.uses_prompt":
			prompts = append(prompts, definitionName(b.index, ref.target))
		case "agent.uses_tool":
			tools = append(tools, definitionName(b.index, ref.target))
		case "agent.can_handoff_to":
			handoffs = append(handoffs, definitionName(b.index, ref.target))
		}
	}
	parts := make([]string, 0, 3)
	if len(prompts) > 0 {
		parts = append(parts, "prompt "+strings.Join(prompts, ", "))
	}
	if len(tools) > 0 {
		parts = append(parts, "tools "+strings.Join(tools, ", "))
	}
	if len(handoffs) > 0 {
		parts = append(parts, "handoffs "+strings.Join(handoffs, ", "))
	}
	if len(parts) == 0 {
		return
	}
	b.section("AGENT LOOP")
	b.lines = append(b.lines, " "+shell.Text.Render(sanitizeIndexInline(strings.Join(parts, "  →  "))))
}

func (b *indexDocumentBuilder) renderFlowHero() {
	steps := metadataStepNames(b.definition.Metadata)
	if len(steps) == 0 {
		_, outgoing := indexRelations(b.index, b.definition.ID)
		for _, ref := range outgoing {
			if strings.Contains(ref.relation.Type, "step") {
				steps = append(steps, definitionName(b.index, ref.target))
			}
		}
	}
	if len(steps) == 0 {
		return
	}
	numbered := make([]string, len(steps))
	for index, step := range steps {
		numbered[index] = fmt.Sprintf("%d %s", index+1, sanitizeIndexInline(step))
	}
	b.section("FLOW")
	b.lines = append(b.lines, " "+shell.Text.Render(strings.Join(numbered, "  →  ")))
}

func (b *indexDocumentBuilder) renderRoutingHero() {
	_, outgoing := indexRelations(b.index, b.definition.ID)
	if len(outgoing) == 0 {
		return
	}
	b.section("TARGETS")
	for _, ref := range outgoing {
		target := indexKindGlyph(definitionKind(b.index, ref.target)) + " " +
			sanitizeIndexInline(definitionName(b.index, ref.target))
		b.field(sanitizeIndexInline(ref.relation.Type), target)
	}
}

func isRoutingDefinition(kind string) bool {
	return kind == "router" || kind == "cascade" ||
		kind == "routing.router" || kind == "routing.cascade"
}

func metadataStepNames(raw json.RawMessage) []string {
	var metadata map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil {
		return nil
	}
	for _, candidate := range []any{
		metadata["stepNames"],
		nestedMap(metadata, "facts")["stepNames"],
		nestedMap(metadata, "facts")["steps"],
		metadata["steps"],
	} {
		if names := stepNames(candidate); len(names) > 0 {
			return names
		}
	}
	return nil
}

func stepNames(value any) []string {
	names := make([]string, 0)
	for _, item := range anySlice(value) {
		switch typed := item.(type) {
		case string:
			names = append(names, typed)
		case map[string]any:
			if name, _ := typed["name"].(string); name != "" {
				names = append(names, name)
			}
		}
	}
	return names
}

func relationTargets(index api.IndexData, definitionID, relationType string) []string {
	_, outgoing := indexRelations(index, definitionID)
	targets := make([]string, 0)
	for _, ref := range outgoing {
		if ref.relation.Type == relationType {
			targets = append(targets, ref.target)
		}
	}
	return targets
}
