package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// datasetSuiteReader is the provisional read surface for Datasets.
//
// It deliberately stays local to the screen package so Phase 14 can render
// fixture-backed suites without expanding the production DataClient contract.
// Phase 20 owns the service-backed `screens.DataClient` method names.
type datasetSuiteReader interface {
	DatasetSuites(context.Context) ([]api.QualitySuiteRecord, error)
}

type datasetsLoadedMsg []api.QualitySuiteRecord
type datasetsPendingMsg string

func fetchDatasets(c DataClient) tea.Cmd {
	return func() tea.Msg {
		reader, ok := c.(datasetSuiteReader)
		if !ok {
			return datasetsPendingMsg("dataset suite service is pending Phase 20")
		}
		suites, err := reader.DatasetSuites(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return datasetsLoadedMsg(suites)
	}
}

func (s *Datasets) currentSuite() *api.QualitySuiteRecord {
	for i := range s.suites {
		if s.suites[i].SuiteID == s.selectedSuite {
			return &s.suites[i]
		}
	}
	if len(s.suites) == 0 {
		return nil
	}
	return &s.suites[0]
}

func (s *Datasets) currentCase() *api.QualitySuiteCase {
	suite := s.currentSuite()
	if suite == nil {
		return nil
	}
	for i := range suite.Cases {
		if suite.Cases[i].CaseID == s.selectedCase {
			return &suite.Cases[i]
		}
	}
	if len(suite.Cases) == 0 {
		return nil
	}
	return &suite.Cases[0]
}
