package qualityfs

func normalizeSuite(record Suite) Suite {
	record.Tag = "QualitySuite"
	if record.SuiteID == "" {
		record.SuiteID = record.ID
	}
	record.ID = ""
	if record.Source == "" {
		record.Source = "json"
	}
	if record.State == "" {
		record.State = "pinned"
	}
	for index, testCase := range record.Cases {
		record.Cases[index] = normalizeSuiteCase(testCase)
	}
	if len(record.Cases) > 0 {
		record.CaseCount = len(record.Cases)
	}
	return record
}

func NormalizeSuite(record Suite) Suite {
	return normalizeSuite(record)
}

func normalizeSuiteCase(testCase SuiteCase) SuiteCase {
	if testCase.CaseID == "" {
		testCase.CaseID = testCase.ID
	}
	testCase.ID = ""
	if testCase.Assertions == nil {
		testCase.Assertions = []SuiteAssertion{}
	}
	return testCase
}

func NormalizeSuiteCase(testCase SuiteCase) SuiteCase {
	return normalizeSuiteCase(testCase)
}
