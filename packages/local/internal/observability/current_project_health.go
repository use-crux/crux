package observability

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// CurrentProjectHealthMatchKind identifies how a current lint finding reaches
// a definition observed by the run.
type CurrentProjectHealthMatchKind string

const (
	CurrentProjectHealthPrimary    CurrentProjectHealthMatchKind = "primary"
	CurrentProjectHealthRelated    CurrentProjectHealthMatchKind = "related"
	CurrentProjectHealthAffected   CurrentProjectHealthMatchKind = "affected"
	CurrentProjectHealthPropagated CurrentProjectHealthMatchKind = "propagated"
)

// CurrentProjectHealthMatch describes one run-observed definition reached by a
// current Project Index finding.
type CurrentProjectHealthMatch struct {
	DefinitionID string                          `json:"definitionId"`
	Kind         string                          `json:"kind"`
	Roles        []string                        `json:"roles"`
	MatchKinds   []CurrentProjectHealthMatchKind `json:"matchKinds"`
}

// CurrentProjectHealthFinding is the current authored lint context relevant to
// definitions observed by a run. It is not historical runtime evidence.
type CurrentProjectHealthFinding struct {
	ID                 string                       `json:"id"`
	RuleID             string                       `json:"ruleId"`
	Severity           string                       `json:"severity"`
	Title              string                       `json:"title"`
	Message            string                       `json:"message"`
	Source             *store.SourceLoc             `json:"source,omitempty"`
	Suppressed         bool                         `json:"suppressed,omitempty"`
	SuppressedBy       *store.IndexLintSuppressedBy `json:"suppressedBy,omitempty"`
	MatchedDefinitions []CurrentProjectHealthMatch  `json:"matchedDefinitions"`
}

// CurrentProjectHealth is read-time context from the currently materialized
// Project Index. It is never persisted and never contributes to run status.
type CurrentProjectHealth struct {
	Label           string                        `json:"label"`
	IndexedAt       string                        `json:"indexedAt"`
	ActiveCount     int                           `json:"activeCount"`
	SuppressedCount int                           `json:"suppressedCount"`
	Findings        []CurrentProjectHealthFinding `json:"findings"`
}

// CompareCurrentProjectHealth correlates runtime DefinitionRefs with findings
// from the current Project Index. A nil result means no materialized Index was
// available; a non-nil result with an empty findings slice means it was checked.
func CompareCurrentProjectHealth(refs []DefinitionRef, index store.IndexData) *CurrentProjectHealth {
	if index.IndexedAt == "" {
		return nil
	}

	refsByID := make(map[string]*currentProjectHealthRef, len(refs))
	for _, ref := range refs {
		if ref.ID == "" {
			continue
		}
		entry := refsByID[ref.ID]
		if entry == nil {
			entry = &currentProjectHealthRef{roles: make(map[string]struct{})}
			refsByID[ref.ID] = entry
		}
		if entry.kind == "" || (ref.Kind != "" && ref.Kind < entry.kind) {
			entry.kind = ref.Kind
		}
		if ref.Role != "" {
			entry.roles[ref.Role] = struct{}{}
		}
	}
	health := &CurrentProjectHealth{
		Label:     "current-project-health",
		IndexedAt: index.IndexedAt,
		Findings:  make([]CurrentProjectHealthFinding, 0),
	}
	projectRoot := ""
	if index.Project != nil {
		projectRoot = index.Project.Root
	}
	for _, finding := range index.LintFindings {
		matches := make(map[string]map[CurrentProjectHealthMatchKind]struct{})
		addCurrentProjectHealthMatch(matches, refsByID, finding.PrimaryDefinitionID, CurrentProjectHealthPrimary)
		for _, definitionID := range finding.RelatedDefinitionIDs {
			addCurrentProjectHealthMatch(matches, refsByID, definitionID, CurrentProjectHealthRelated)
		}
		for _, definitionID := range finding.AffectedDefinitionIDs {
			addCurrentProjectHealthMatch(matches, refsByID, definitionID, CurrentProjectHealthAffected)
		}
		for _, definitionID := range finding.PropagatedDefinitionIDs {
			addCurrentProjectHealthMatch(matches, refsByID, definitionID, CurrentProjectHealthPropagated)
		}
		if len(matches) == 0 {
			continue
		}
		source := currentProjectHealthSource(projectRoot, finding.Source)
		suppressedBy := currentProjectHealthSuppressedBy(projectRoot, finding.SuppressedBy)
		if finding.Suppressed && suppressedBy == nil {
			continue
		}
		health.Findings = append(health.Findings, CurrentProjectHealthFinding{
			ID: finding.ID, RuleID: finding.RuleID, Severity: finding.Severity,
			Title: finding.Title, Message: finding.Message, Source: source,
			Suppressed: finding.Suppressed, SuppressedBy: suppressedBy,
			MatchedDefinitions: currentProjectHealthMatches(matches, refsByID),
		})
		if finding.Suppressed {
			health.SuppressedCount++
		} else {
			health.ActiveCount++
		}
	}
	sort.SliceStable(health.Findings, func(i, j int) bool {
		left, right := health.Findings[i], health.Findings[j]
		if currentProjectHealthSeverity(left.Severity) != currentProjectHealthSeverity(right.Severity) {
			return currentProjectHealthSeverity(left.Severity) > currentProjectHealthSeverity(right.Severity)
		}
		if left.RuleID != right.RuleID {
			return left.RuleID < right.RuleID
		}
		return left.ID < right.ID
	})
	return health
}

func currentProjectHealthSeverity(severity string) int {
	switch severity {
	case "error":
		return 3
	case "warning":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

type currentProjectHealthRef struct {
	kind  string
	roles map[string]struct{}
}

func addCurrentProjectHealthMatch(
	matches map[string]map[CurrentProjectHealthMatchKind]struct{},
	refsByID map[string]*currentProjectHealthRef,
	definitionID string,
	kind CurrentProjectHealthMatchKind,
) {
	if refsByID[definitionID] == nil {
		return
	}
	if matches[definitionID] == nil {
		matches[definitionID] = make(map[CurrentProjectHealthMatchKind]struct{})
	}
	matches[definitionID][kind] = struct{}{}
}

func currentProjectHealthMatches(
	matches map[string]map[CurrentProjectHealthMatchKind]struct{},
	refsByID map[string]*currentProjectHealthRef,
) []CurrentProjectHealthMatch {
	definitionIDs := make([]string, 0, len(matches))
	for definitionID := range matches {
		definitionIDs = append(definitionIDs, definitionID)
	}
	sort.Strings(definitionIDs)
	result := make([]CurrentProjectHealthMatch, 0, len(definitionIDs))
	for _, definitionID := range definitionIDs {
		ref := refsByID[definitionID]
		roles := make([]string, 0, len(ref.roles))
		for role := range ref.roles {
			roles = append(roles, role)
		}
		sort.Strings(roles)
		orderedKinds := make([]CurrentProjectHealthMatchKind, 0, len(matches[definitionID]))
		for _, kind := range []CurrentProjectHealthMatchKind{
			CurrentProjectHealthPrimary,
			CurrentProjectHealthRelated,
			CurrentProjectHealthAffected,
			CurrentProjectHealthPropagated,
		} {
			if _, exists := matches[definitionID][kind]; exists {
				orderedKinds = append(orderedKinds, kind)
			}
		}
		result = append(result, CurrentProjectHealthMatch{
			DefinitionID: definitionID,
			Kind:         ref.kind,
			Roles:        roles,
			MatchKinds:   orderedKinds,
		})
	}
	return result
}
