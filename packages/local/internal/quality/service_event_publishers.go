package quality

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func (s *Service) publishDerivedInsightChanges(insights []qualityInsightRecord) {
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
			s.bus.Publish(api.QualityEvent{
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
				s.bus.Publish(api.QualityEvent{
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

func (s *Service) publishCassetteDriftChanges(cassettes []qualityfs.Cassette) {
	s.derivedMu.Lock()
	defer s.derivedMu.Unlock()

	next := make(map[string]string, len(cassettes))
	for _, cassette := range cassettes {
		if cassette.Path == "" {
			continue
		}
		signature := cassetteDriftSignature(cassette)
		next[cassette.Path] = signature
		if s.cassettesPrimed && s.cassetteSignatures[cassette.Path] != signature {
			payload, _ := json.Marshal(cassette)
			s.bus.Publish(api.QualityEvent{
				Kind:     "cassette",
				Action:   "drift",
				Severity: cassetteDriftSeverity(cassette),
				RefID:    cassette.Path,
				Payload:  payload,
			})
		}
	}
	if s.cassettesPrimed {
		for path := range s.cassetteSignatures {
			if _, ok := next[path]; !ok {
				s.bus.Publish(api.QualityEvent{
					Kind:     "cassette",
					Action:   "drift",
					Severity: "info",
					RefID:    path,
				})
			}
		}
	}
	s.cassetteSignatures = next
	s.cassettesPrimed = true
}

func insightSignature(insight qualityInsightRecord) string {
	parts := []string{
		insight.Title,
		insight.Severity,
		insight.Status,
		strconv.Itoa(insight.OccurrenceCount),
		strings.Join(insight.LinkedTraceIDs, ","),
		strings.Join(insight.LinkedExperimentIDs, ","),
		strings.Join(insight.LinkedCaseIDs, ","),
		strings.Join(insight.LinkedCassettePaths, ","),
		insight.UpdatedAt,
	}
	return strings.Join(parts, "|")
}

func cassetteDriftSignature(cassette qualityfs.Cassette) string {
	return fmt.Sprintf("%s|%d|%d|%d|%.4f",
		cassette.Status,
		cassette.EntryCount,
		cassette.MissingCount,
		cassette.MismatchCount,
		cassette.Coverage,
	)
}

func cassetteDriftSeverity(cassette qualityfs.Cassette) string {
	if cassette.MismatchCount > 0 {
		return "error"
	}
	if cassette.MissingCount > 0 {
		return "warn"
	}
	return "info"
}
