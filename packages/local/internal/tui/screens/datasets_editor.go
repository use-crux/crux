package screens

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type datasetField int

const (
	datasetFieldTags datasetField = iota
	datasetFieldInput
	datasetFieldExpected
	datasetFieldAssertions
)

func (f datasetField) label() string {
	switch f {
	case datasetFieldTags:
		return "tags"
	case datasetFieldInput:
		return "input"
	case datasetFieldExpected:
		return "expected"
	case datasetFieldAssertions:
		return "assertions"
	default:
		return "field"
	}
}

func (s *Datasets) focusLeft() {
	if s.focus > datasetsFocusSuites {
		s.focus--
	}
}

func (s *Datasets) focusRight() {
	if s.focus < datasetsFocusEditor {
		s.focus++
	}
}

func (s *Datasets) nextField() {
	s.editorField = (s.editorField + 1) % 4
	s.confirmLeave = false
}

func (s *Datasets) escape() {
	if s.focus != datasetsFocusEditor {
		return
	}
	if s.dirty && !s.confirmLeave {
		s.confirmLeave = true
		s.notice = "esc again discards local edits"
		return
	}
	if s.dirty {
		s.loadDraft(s.original)
	}
	s.focus = datasetsFocusCases
}

func (s *Datasets) applyText(text string) {
	if s.focus != datasetsFocusEditor || text == "" {
		return
	}
	s.pushUndo()
	switch s.editorField {
	case datasetFieldTags:
		s.draft.Tags = editTags(s.draft.Tags, text)
	case datasetFieldInput:
		s.draft.Input = appendText(s.draft.Input, text)
	case datasetFieldExpected:
		s.draft.Expected = appendText(s.draft.Expected, text)
	case datasetFieldAssertions:
		if len(s.draft.Assertions) == 0 {
			s.draft.Assertions = append(s.draft.Assertions, api.QualitySuiteAssertion{Op: "contains"})
		}
		last := len(s.draft.Assertions) - 1
		s.draft.Assertions[last].Arg += text
	}
	s.markDirty()
}

func (s *Datasets) addAssertion() {
	if s.focus != datasetsFocusEditor || s.editorField != datasetFieldAssertions {
		return
	}
	s.pushUndo()
	s.draft.Assertions = append(s.draft.Assertions, api.QualitySuiteAssertion{Op: "contains", Arg: "expected text"})
	s.markDirty()
}

func (s *Datasets) deleteAssertion() {
	if s.focus != datasetsFocusEditor || s.editorField != datasetFieldAssertions || len(s.draft.Assertions) == 0 {
		return
	}
	s.pushUndo()
	s.draft.Assertions = s.draft.Assertions[:len(s.draft.Assertions)-1]
	s.markDirty()
}

func (s *Datasets) duplicateCase() {
	cur := s.currentCase()
	suite := s.currentSuite()
	if cur == nil || suite == nil {
		return
	}
	copyCase := cloneDatasetCase(*cur)
	copyCase.CaseID = copyCase.CaseID + "-copy"
	copyCase.Name = firstNonEmpty(copyCase.Name, copyCase.CaseID) + " copy"
	for i := range s.suites {
		if s.suites[i].SuiteID == suite.SuiteID {
			s.suites[i].Cases = append(s.suites[i].Cases, copyCase)
			s.suites[i].CaseCount = len(s.suites[i].Cases)
			break
		}
	}
	s.selectedCase = copyCase.CaseID
	s.loadDraft(copyCase)
	s.notice = "duplicated locally; save is deferred to Phase 20"
}

func (s *Datasets) pushUndo() {
	s.confirmLeave = false
	if len(s.undo) == 0 || !reflect.DeepEqual(s.undo[len(s.undo)-1], s.draft) {
		s.undo = append(s.undo, cloneDatasetCase(s.draft))
	}
	if len(s.undo) > 100 {
		s.undo = s.undo[len(s.undo)-100:]
	}
}

func (s *Datasets) undoEdit() {
	if len(s.undo) == 0 {
		return
	}
	s.draft = s.undo[len(s.undo)-1]
	s.undo = s.undo[:len(s.undo)-1]
	s.markDirty()
}

func (s *Datasets) markDirty() {
	s.dirty = !reflect.DeepEqual(s.draft, s.original)
	if !s.dirty {
		s.confirmLeave = false
	}
}

func cloneDatasetCase(testCase api.QualitySuiteCase) api.QualitySuiteCase {
	data, err := json.Marshal(testCase)
	if err != nil {
		return testCase
	}
	var out api.QualitySuiteCase
	if err := json.Unmarshal(data, &out); err != nil {
		return testCase
	}
	return out
}

func editTags(tags []string, text string) []string {
	out := append([]string(nil), tags...)
	if len(out) == 0 {
		out = append(out, strings.ToLower(strings.TrimSpace(text)))
		return out
	}
	out[len(out)-1] += strings.ToLower(text)
	return out
}

func appendText(value any, text string) any {
	if value == nil {
		return text
	}
	switch v := value.(type) {
	case string:
		return v + text
	default:
		return fmt.Sprintf("%v%s", v, text)
	}
}

func (s *Datasets) move(delta int) {
	switch s.focus {
	case datasetsFocusSuites:
		s.moveSuite(delta)
	case datasetsFocusCases:
		s.moveCase(delta)
	}
}

func (s *Datasets) moveSuite(delta int) {
	if len(s.suites) == 0 {
		return
	}
	idx := 0
	for i, suite := range s.suites {
		if suite.SuiteID == s.selectedSuite {
			idx = i
			break
		}
	}
	idx = clampInt(idx+delta, 0, len(s.suites)-1)
	s.selectedSuite = s.suites[idx].SuiteID
	s.selectedCase = ""
	s.ensureCaseSelection()
}

func (s *Datasets) moveCase(delta int) {
	suite := s.currentSuite()
	if suite == nil || len(suite.Cases) == 0 {
		return
	}
	idx := 0
	for i, testCase := range suite.Cases {
		if testCase.CaseID == s.selectedCase {
			idx = i
			break
		}
	}
	idx = clampInt(idx+delta, 0, len(suite.Cases)-1)
	s.selectedCase = suite.Cases[idx].CaseID
	s.loadDraft(suite.Cases[idx])
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
