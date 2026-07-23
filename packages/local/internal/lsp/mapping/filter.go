package mapping

import "github.com/use-crux/crux/packages/local/internal/api"

// FilterOptions controls presentation-only lint selection in attach mode.
type FilterOptions struct {
	Profile           string
	IncludeSuppressed bool
}

// FilterFindings applies editor settings without mutating the server-owned
// Project Index view.
func FilterFindings(findings []api.IndexLintFinding, options FilterOptions) []api.IndexLintFinding {
	if options.Profile == "off" {
		return []api.IndexLintFinding{}
	}
	result := make([]api.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		if finding.Suppressed && !options.IncludeSuppressed {
			continue
		}
		if options.Profile != "" && !contains(finding.Profiles, options.Profile) {
			continue
		}
		result = append(result, finding)
	}
	return result
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
