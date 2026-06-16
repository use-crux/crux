package commands

// --junit artifact writer for `crux quality run` (spec 03 §6): maps the run to
// JUnit XML — one <testsuite> per (evaluationId, variantName), one <testcase>
// per case with trials aggregated; a gate failure appends a synthetic "gates"
// testcase. Pure data mapping over the reporter's accumulated state.

import (
	"encoding/xml"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/domain"
)

type junitTestsuites struct {
	XMLName xml.Name         `xml:"testsuites"`
	Suites  []junitTestsuite `xml:"testsuite"`
}

type junitTestsuite struct {
	Name       string          `xml:"name,attr"`
	Tests      int             `xml:"tests,attr"`
	Failures   int             `xml:"failures,attr"`
	Errors     int             `xml:"errors,attr"`
	Skipped    int             `xml:"skipped,attr"`
	Time       float64         `xml:"time,attr"`
	Properties []junitProperty `xml:"properties>property"`
	Cases      []junitTestcase `xml:"testcase"`
}

type junitProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

type junitTestcase struct {
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitMessage `xml:"failure,omitempty"`
	Error   *junitMessage `xml:"error,omitempty"`
	Skipped *junitMessage `xml:"skipped,omitempty"`
}

type junitMessage struct {
	Message string `xml:"message,attr"`
	Body    string `xml:",chardata"`
}

func writeQualityJUnit(path string, reporter *qualityReporter) error {
	var suites junitTestsuites
	for _, evaluationID := range reporter.order {
		state := reporter.evals[evaluationID]
		byVariant := map[string][]domain.QualityCell{}
		for _, cell := range state.cells {
			byVariant[cell.VariantName] = append(byVariant[cell.VariantName], cell)
		}
		variantNames := make([]string, 0, len(byVariant))
		for name := range byVariant {
			variantNames = append(variantNames, name)
		}
		sort.Strings(variantNames)

		for _, variantName := range variantNames {
			suite := junitTestsuite{Name: evaluationID + "." + variantName}
			suite.Properties = append(suite.Properties, junitProperty{Name: "experimentId", Value: state.experimentID})
			if state.configFingerprint != "" {
				suite.Properties = append(suite.Properties, junitProperty{Name: "configFingerprint", Value: state.configFingerprint})
			}
			if state.aggregates != nil {
				if aggregate, ok := state.aggregates.PerVariant[variantName]; ok {
					for scoreName, score := range aggregate.Scores {
						suite.Properties = append(suite.Properties, junitProperty{
							Name:  "score." + scoreName,
							Value: fmt.Sprintf("%.4f", score.Mean),
						})
					}
				}
			}
			sort.Slice(suite.Properties, func(i, j int) bool { return suite.Properties[i].Name < suite.Properties[j].Name })

			for _, group := range groupCellsByCase(byVariant[variantName]) {
				testcase := junitTestcase{Name: caseGroupName(group), Time: meanDurationSeconds(group)}
				if cell := firstWithStatus(group, "errored"); cell != nil {
					testcase.Error = &junitMessage{Message: cell.Error.Message}
				} else if cell := firstWithStatus(group, "failed"); cell != nil {
					if len(cell.Assertions.Failures) > 0 {
						failure := cell.Assertions.Failures[0]
						body := failure.Message
						if failure.SourceRef != "" {
							body += "\nat " + failure.SourceRef
						}
						testcase.Failure = &junitMessage{Message: failure.Matcher, Body: body}
					} else {
						testcase.Failure = &junitMessage{Message: "failed"}
					}
				} else if cell := firstWithStatus(group, "skipped"); cell != nil && len(group) == 1 {
					testcase.Skipped = &junitMessage{Message: cell.SkipReason}
				}
				suite.Tests++
				if testcase.Failure != nil {
					suite.Failures++
				}
				if testcase.Error != nil {
					suite.Errors++
				}
				if testcase.Skipped != nil {
					suite.Skipped++
				}
				suite.Time += testcase.Time
				suite.Cases = append(suite.Cases, testcase)
			}

			if state.gates != nil && !state.gates.Informational {
				gatesCase := junitTestcase{Name: "gates"}
				if !state.gates.Passed {
					var failed []string
					for _, result := range state.gates.Results {
						if !result.Passed && !result.Informational {
							failed = append(failed, result.Gate)
						}
					}
					gatesCase.Failure = &junitMessage{Message: "gate failure", Body: strings.Join(failed, ", ")}
					suite.Failures++
				}
				suite.Tests++
				suite.Cases = append(suite.Cases, gatesCase)
			}
			suites.Suites = append(suites.Suites, suite)
		}
	}

	out, err := xml.MarshalIndent(suites, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append([]byte(xml.Header), append(out, '\n')...), 0o644)
}

func groupCellsByCase(cells []domain.QualityCell) [][]domain.QualityCell {
	order := []string{}
	groups := map[string][]domain.QualityCell{}
	for _, cell := range cells {
		if _, ok := groups[cell.CaseID]; !ok {
			order = append(order, cell.CaseID)
		}
		groups[cell.CaseID] = append(groups[cell.CaseID], cell)
	}
	result := make([][]domain.QualityCell, 0, len(order))
	for _, caseID := range order {
		result = append(result, groups[caseID])
	}
	return result
}

func caseGroupName(group []domain.QualityCell) string {
	if group[0].CaseName != "" {
		return group[0].CaseName
	}
	return group[0].CaseID
}

func meanDurationSeconds(group []domain.QualityCell) float64 {
	if len(group) == 0 {
		return 0
	}
	total := 0.0
	for _, cell := range group {
		total += cell.DurationMs
	}
	return total / float64(len(group)) / 1000
}

func firstWithStatus(group []domain.QualityCell, status string) *domain.QualityCell {
	for i := range group {
		if group[i].Status == status {
			return &group[i]
		}
	}
	return nil
}
