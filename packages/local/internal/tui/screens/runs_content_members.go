package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func renderMemberRuns(detail api.ObservabilityRunDetail, width int) string {
	members := childMemberRuns(detail)
	if len(members) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(diagnosisSection("MEMBER RUNS · m DRILL"))
	for _, member := range members {
		run := member.Run
		label := "child"
		value := firstNonEmpty(run.Name, run.RunID)
		if run.Status != "" {
			value += " · " + run.Status
		}
		if run.DurationMs > 0 {
			value += " · " + formatSpanDuration(run.DurationMs)
		}
		if member.TriggeredBySpanID != "" {
			value += " · via " + kit.TruncateMiddle(sanitizeRunsInline(member.TriggeredBySpanID), 16, "…")
		}
		color := shell.ColorText
		if isAbnormalOperationStatus(run.Status) {
			color = shell.ColorRose
		}
		b.WriteString(kvRowColored(label, strings.Trim(value, " ·"), color, width))
	}
	b.WriteString(kvRow("members", fmt.Sprintf("%d child %s", len(members), kit.Pluralize(len(members), "run")), width))
	return strings.TrimRight(b.String(), "\n")
}

func (s *Runs) firstMemberRun() *observability.OperationRunDetail {
	if s.diagnosis == nil {
		return nil
	}
	members := childMemberRuns(s.diagnosis.Raw)
	if len(members) == 0 {
		return nil
	}
	member := members[0]
	return &member
}

func detailForMember(schemaVersion int, member observability.OperationRunDetail) api.ObservabilityRunDetail {
	return api.ObservabilityRunDetail{
		SchemaVersion: schemaVersion,
		Run:           member.Run,
		Redaction:     member.Root.Redaction,
		Root:          member.Root,
		Facets:        memberFacets(member.Root),
		Diagnostics:   member.Diagnostics,
	}
}

func detailForSelectedMember(
	detail api.ObservabilityRunDetail,
	selectedID string,
) (api.ObservabilityRunDetail, bool) {
	for _, member := range detail.MemberRuns {
		if member.Run.RunID == selectedID {
			return detailForMember(detail.SchemaVersion, member), true
		}
	}
	return api.ObservabilityRunDetail{}, false
}

func memberFacets(root api.ObservabilityRunDetailNode) map[string]map[string]int {
	facets := map[string]map[string]int{}
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		for facet, value := range map[string]string{
			"family": node.Family, "primitive": node.Primitive, "model": node.Model,
			"provider": node.Provider, "status": node.Status,
		} {
			if value == "" {
				continue
			}
			if facets[facet] == nil {
				facets[facet] = map[string]int{}
			}
			facets[facet][value]++
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return facets
}
