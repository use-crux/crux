package inspect

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) publishDerivedInsightChanges(insights []inspectInsightRecord) {
	s.derivedMu.Lock()
	defer s.derivedMu.Unlock()

	next := make(map[string]string, len(insights))
	for _, insight := range insights {
		if insight.InsightID == "" {
			continue
		}
		signature := insightSignature(insight)
		next[insight.InsightID] = signature
		if s.insightsPrimed && s.insightSignatures[insight.InsightID] != signature {
			payload, _ := json.Marshal(insight)
			s.bus.Publish(api.InspectEvent{
				Kind:     "insight",
				Action:   "changed",
				Severity: nonEmptyString(insight.Severity, "info"),
				RefID:    insight.InsightID,
				Payload:  payload,
			})
		}
	}
	if s.insightsPrimed {
		for id := range s.insightSignatures {
			if _, ok := next[id]; !ok {
				s.bus.Publish(api.InspectEvent{
					Kind:     "insight",
					Action:   "changed",
					Severity: "info",
					RefID:    id,
				})
			}
		}
	}
	s.insightSignatures = next
	s.insightsPrimed = true
}

func insightSignature(insight inspectInsightRecord) string {
	parts := []string{
		insight.Title,
		insight.Severity,
		insight.Status,
		strconv.Itoa(insight.OccurrenceCount),
		strings.Join(insight.LinkedTraceIDs, ","),
		strings.Join(insight.LinkedCaseIDs, ","),
		insight.UpdatedAt,
	}
	return strings.Join(parts, "|")
}
