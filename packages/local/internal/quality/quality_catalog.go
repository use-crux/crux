package quality

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

var qualityCatalogSafeIDPattern = regexp.MustCompile(`[^a-zA-Z0-9_.:-]+`)
var catalogLintSuppressionPattern = regexp.MustCompile(`crux-lint-disable-(next-line|line|file)\s+([a-zA-Z0-9_.-]+)(?:\s+--\s*(.*))?`)

// EnrichCatalog attaches file-backed quality asset links to a catalog copy.
// The source/indexer catalog remains authoritative; this is a read-model join.
func (s *Service) EnrichCatalog(catalog store.CatalogData) store.CatalogData {
	if len(catalog.Definitions) == 0 {
		return catalog
	}
	definitions := append([]store.ProjectDefinition(nil), catalog.Definitions...)
	catalog.Definitions = definitions

	defByID := make(map[string]*store.ProjectDefinition, len(definitions))
	for i := range definitions {
		defByID[definitions[i].ID] = &definitions[i]
	}

	experiments, err := readQualityExperimentRecords(s.dir)
	if err == nil {
		for _, experiment := range experiments {
			s.enrichCatalogWithExperiment(defByID, experiment)
		}
	}

	baselines, err := readQualityBaselineRecords(s.dir)
	if err == nil {
		experimentByID := map[string]qualityExperimentRecord{}
		for _, experiment := range experiments {
			experimentByID[experiment.ID] = experiment
		}
		for _, baseline := range baselines {
			s.enrichCatalogWithBaseline(defByID, baseline, experimentByID[baseline.ExperimentID])
		}
	}

	suites, err := readQualitySuiteRecords(s.dir)
	if err == nil {
		for _, suite := range suites {
			addSuiteQuality(defByID, suite)
		}
	}

	comparisons, err := readQualityComparisonRecords(s.dir)
	if err == nil {
		experimentByID := map[string]qualityExperimentRecord{}
		for _, experiment := range experiments {
			experimentByID[experiment.ID] = experiment
		}
		for _, comparison := range comparisons {
			s.enrichCatalogWithComparison(defByID, comparison, experimentByID)
		}
	}

	cassettes, err := readQualityCassettes(filepath.Join(s.dir, "cassettes"))
	if err == nil {
		for _, cassette := range cassettes {
			s.enrichCatalogWithCassette(defByID, cassette)
		}
	}

	feedback, err := readQualityFeedbackRecords(s.dir)
	if err == nil {
		s.enrichCatalogWithFeedback(defByID, feedback, experiments)
	}

	addAffectedQualitySuggestions(catalog.Definitions, catalog.Relations)
	addQualityDrift(catalog.Definitions, experiments, baselines)
	addQualityLintFindings(&catalog)
	applyCatalogLintPolicy(&catalog)

	return catalog
}

func readQualityBaselineRecords(dir string) ([]qualityBaselineRecord, error) {
	raw, err := readQualityRecords(dir, "baselines")
	if err != nil {
		return nil, err
	}
	baselines := make([]qualityBaselineRecord, 0, len(raw))
	for _, item := range raw {
		var baseline qualityBaselineRecord
		if err := json.Unmarshal(item, &baseline); err != nil {
			return nil, err
		}
		baselines = append(baselines, baseline)
	}
	return baselines, nil
}

func readQualityComparisonRecords(dir string) ([]qualityComparisonRecord, error) {
	raw, err := readQualityRecords(dir, "comparisons")
	if err != nil {
		return nil, err
	}
	comparisons := make([]qualityComparisonRecord, 0, len(raw))
	for _, item := range raw {
		var comparison qualityComparisonRecord
		if err := json.Unmarshal(item, &comparison); err != nil {
			return nil, err
		}
		comparisons = append(comparisons, comparison)
	}
	return comparisons, nil
}

func (s *Service) enrichCatalogWithExperiment(defByID map[string]*store.ProjectDefinition, experiment qualityExperimentRecord) {
	if experiment.ID == "" {
		return
	}
	if experiment.Suite.ID != "" {
		addExperimentQuality(defByID, "suite:"+safeQualityCatalogID(experiment.Suite.ID), experiment)
	}
	for _, variant := range experiment.Variants {
		for _, defID := range qualityTargetDefinitionIDs(variant.TargetID) {
			addExperimentQuality(defByID, defID, experiment)
		}
	}
}

func (s *Service) enrichCatalogWithBaseline(defByID map[string]*store.ProjectDefinition, baseline qualityBaselineRecord, experiment qualityExperimentRecord) {
	if baseline.ID == "" {
		return
	}
	if experiment.Suite.ID != "" {
		addBaselineQuality(defByID, "suite:"+safeQualityCatalogID(experiment.Suite.ID), baseline, experiment, qualityExperimentVariant{})
	}
	for _, variant := range experiment.Variants {
		if baseline.VariantID == nil || *baseline.VariantID == variant.ID {
			for _, defID := range qualityTargetDefinitionIDs(variant.TargetID) {
				addBaselineQuality(defByID, defID, baseline, experiment, variant)
			}
		}
	}
}

func (s *Service) enrichCatalogWithComparison(defByID map[string]*store.ProjectDefinition, comparison qualityComparisonRecord, experimentByID map[string]qualityExperimentRecord) {
	if comparison.ID == "" {
		return
	}
	for _, experimentID := range []string{comparison.Baseline.ExperimentID, comparison.Candidate.ExperimentID} {
		experiment := experimentByID[experimentID]
		if experiment.Suite.ID != "" {
			addComparisonQuality(defByID, "suite:"+safeQualityCatalogID(experiment.Suite.ID), comparison, experiment)
		}
		for _, variant := range experiment.Variants {
			for _, defID := range qualityTargetDefinitionIDs(variant.TargetID) {
				addComparisonQuality(defByID, defID, comparison, experiment)
			}
		}
	}
}

func (s *Service) enrichCatalogWithCassette(defByID map[string]*store.ProjectDefinition, cassette qualityCassetteSummary) {
	if cassette.Path == "" {
		return
	}
	for _, entry := range cassette.Entries {
		for _, defID := range qualityTargetDefinitionIDs(entry.TargetID) {
			addCassetteQuality(defByID, defID, cassette, entry)
		}
	}
}

func (s *Service) enrichCatalogWithFeedback(defByID map[string]*store.ProjectDefinition, feedback []qualityFeedbackRecord, experiments []qualityExperimentRecord) {
	experimentByID := map[string]qualityExperimentRecord{}
	traceToDefinitionIDs := map[string][]string{}
	for _, experiment := range experiments {
		experimentByID[experiment.ID] = experiment
		defIDs := experimentDefinitionIDs(experiment)
		for _, testCase := range experiment.Cases {
			if testCase.TraceID == "" {
				continue
			}
			for _, defID := range defIDs {
				traceToDefinitionIDs[testCase.TraceID] = appendQualityUniqueString(traceToDefinitionIDs[testCase.TraceID], defID)
			}
		}
	}
	for _, record := range feedback {
		defIDs := []string{}
		if record.ExperimentID != nil {
			defIDs = append(defIDs, experimentDefinitionIDs(experimentByID[*record.ExperimentID])...)
		}
		if record.TraceID != nil {
			defIDs = append(defIDs, traceToDefinitionIDs[*record.TraceID]...)
		}
		for _, defID := range defIDs {
			addFeedbackQuality(defByID, defID, record)
		}
	}
}

func addExperimentQuality(defByID map[string]*store.ProjectDefinition, defID string, experiment qualityExperimentRecord) {
	def := defByID[defID]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	if !containsQualityString(q.ExperimentIDs, experiment.ID) {
		q.ExperimentIDs = append(q.ExperimentIDs, experiment.ID)
		q.ExperimentCount++
	}
	if experiment.Suite.ID != "" {
		q.SuiteIDs = appendQualityUniqueString(q.SuiteIDs, experiment.Suite.ID)
	}
	for _, testCase := range experiment.Cases {
		q.TraceIDs = appendQualityUniqueString(q.TraceIDs, testCase.TraceID)
	}
	if t := parseCatalogQualityTime(nonEmptyString(experiment.EndedAt, experiment.StartedAt)); t > q.LastRunAt {
		q.LastRunAt = t
		q.LastRunID = experiment.ID
		q.LastStatus = experiment.Status
	}
	if experiment.Summary.Total > 0 && q.PassRate == nil {
		passRate := float64(experiment.Summary.Passed) / float64(experiment.Summary.Total)
		q.PassRate = &passRate
	}
}

func addBaselineQuality(defByID map[string]*store.ProjectDefinition, defID string, baseline qualityBaselineRecord, experiment qualityExperimentRecord, variant qualityExperimentVariant) {
	def := defByID[defID]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	if !containsQualityString(q.BaselineIDs, baseline.ID) {
		q.BaselineIDs = append(q.BaselineIDs, baseline.ID)
		q.BaselineCount++
	}
	q.ExperimentIDs = appendQualityUniqueString(q.ExperimentIDs, baseline.ExperimentID)
	if experiment.Suite.ID != "" {
		q.SuiteIDs = appendQualityUniqueString(q.SuiteIDs, experiment.Suite.ID)
	}
	if variant.DefinitionFingerprint != "" && def.Fingerprint != "" {
		changed := variant.DefinitionFingerprint != def.Fingerprint
		q.BaselineFingerprint = variant.DefinitionFingerprint
		q.CurrentFingerprint = def.Fingerprint
		q.ChangedSinceBaseline = &changed
		if changed {
			q.AffectedEvalIDs = appendQualityUniqueStrings(q.AffectedEvalIDs, q.EvalIDs...)
			q.AffectedSuiteIDs = appendQualityUniqueStrings(q.AffectedSuiteIDs, q.SuiteIDs...)
		}
	}
}

func addSuiteQuality(defByID map[string]*store.ProjectDefinition, suite qualitySuiteRecord) {
	def := defByID["suite:"+safeQualityCatalogID(suite.SuiteID)]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	q.SuiteIDs = appendQualityUniqueString(q.SuiteIDs, suite.SuiteID)
	if suite.CaseCount > q.CaseCount {
		q.CaseCount = suite.CaseCount
	}
	if suite.LastExperimentID != "" {
		q.ExperimentIDs = appendQualityUniqueString(q.ExperimentIDs, suite.LastExperimentID)
	}
	if suite.LastPassRate != nil && q.PassRate == nil {
		passRate := *suite.LastPassRate
		q.PassRate = &passRate
	}
	if t := parseCatalogQualityTime(suite.LastRunAt); t > q.LastRunAt {
		q.LastRunAt = t
		q.LastRunID = suite.LastExperimentID
		q.LastStatus = "completed"
	}
}

func addComparisonQuality(defByID map[string]*store.ProjectDefinition, defID string, comparison qualityComparisonRecord, experiment qualityExperimentRecord) {
	def := defByID[defID]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	if !containsQualityString(q.ComparisonIDs, comparison.ID) {
		q.ComparisonIDs = append(q.ComparisonIDs, comparison.ID)
		q.ComparisonCount++
	}
	q.ExperimentIDs = appendQualityUniqueString(q.ExperimentIDs, comparison.Baseline.ExperimentID)
	q.ExperimentIDs = appendQualityUniqueString(q.ExperimentIDs, comparison.Candidate.ExperimentID)
	if experiment.Suite.ID != "" {
		q.SuiteIDs = appendQualityUniqueString(q.SuiteIDs, experiment.Suite.ID)
	}
	if t := parseCatalogQualityTime(comparison.ComparedAt); t > q.LastRunAt {
		q.LastRunAt = t
		q.LastRunID = comparison.ID
		q.LastStatus = comparison.Status
	}
}

func addCassetteQuality(defByID map[string]*store.ProjectDefinition, defID string, cassette qualityCassetteSummary, entry qualityCassetteEntrySummary) {
	def := defByID[defID]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	if !containsQualityString(q.CassettePaths, cassette.Path) {
		q.CassettePaths = append(q.CassettePaths, cassette.Path)
		q.CassetteCount++
	}
	if entry.CaseID != "" {
		q.RunIDs = appendQualityUniqueString(q.RunIDs, entry.CaseID)
	}
}

func addFeedbackQuality(defByID map[string]*store.ProjectDefinition, defID string, feedback qualityFeedbackRecord) {
	def := defByID[defID]
	if def == nil {
		return
	}
	q := ensureDefinitionQuality(def)
	if !containsQualityString(q.FeedbackIDs, feedback.ID) {
		q.FeedbackIDs = append(q.FeedbackIDs, feedback.ID)
		q.FeedbackCount++
	}
	if feedback.TraceID != nil {
		q.TraceIDs = appendQualityUniqueString(q.TraceIDs, *feedback.TraceID)
	}
	if feedback.ExperimentID != nil {
		q.ExperimentIDs = appendQualityUniqueString(q.ExperimentIDs, *feedback.ExperimentID)
	}
}

func addAffectedQualitySuggestions(definitions []store.ProjectDefinition, relations []store.ProjectRelation) {
	defByID := make(map[string]*store.ProjectDefinition, len(definitions))
	dependentsByTarget := map[string][]string{}
	for i := range definitions {
		defByID[definitions[i].ID] = &definitions[i]
	}
	for _, rel := range relations {
		if rel.From == "" || rel.To == "" {
			continue
		}
		dependentsByTarget[rel.To] = appendQualityUniqueString(dependentsByTarget[rel.To], rel.From)
	}
	for i := range definitions {
		q := definitions[i].Quality
		if q == nil || q.ChangedSinceBaseline == nil || !*q.ChangedSinceBaseline {
			continue
		}
		for _, affectedID := range affectedDefinitionIDs(definitions[i].ID, dependentsByTarget) {
			affected := defByID[affectedID]
			if affected == nil {
				continue
			}
			addAffectedDefinitionQuality(q, *affected)
		}
	}
}

func affectedDefinitionIDs(changedID string, dependentsByTarget map[string][]string) []string {
	seen := map[string]bool{changedID: true}
	queue := append([]string(nil), dependentsByTarget[changedID]...)
	affected := []string{}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == "" || seen[current] {
			continue
		}
		seen[current] = true
		affected = appendQualityUniqueString(affected, current)
		queue = append(queue, dependentsByTarget[current]...)
	}
	return affected
}

func addAffectedDefinitionQuality(q *store.CatalogQuality, affected store.ProjectDefinition) {
	if affected.Quality != nil {
		q.AffectedEvalIDs = appendQualityUniqueStrings(q.AffectedEvalIDs, affected.Quality.EvalIDs...)
		q.AffectedSuiteIDs = appendQualityUniqueStrings(q.AffectedSuiteIDs, affected.Quality.SuiteIDs...)
	}
	switch affected.Kind {
	case "eval.prompt", "eval.flow", "eval.rag":
		q.AffectedEvalIDs = appendQualityUniqueString(q.AffectedEvalIDs, definitionLocalID(affected.ID))
	case "suite":
		q.AffectedSuiteIDs = appendQualityUniqueString(q.AffectedSuiteIDs, definitionLocalID(affected.ID))
	}
}

func addQualityDrift(definitions []store.ProjectDefinition, experiments []qualityExperimentRecord, baselines []qualityBaselineRecord) {
	if len(definitions) == 0 || len(experiments) == 0 || len(baselines) == 0 {
		return
	}
	defByID := make(map[string]store.ProjectDefinition, len(definitions))
	for _, def := range definitions {
		defByID[def.ID] = def
	}
	experimentByID := make(map[string]qualityExperimentRecord, len(experiments))
	for _, experiment := range experiments {
		experimentByID[experiment.ID] = experiment
	}
	latestBaseline := map[string]qualityBaselineRecord{}
	for _, baseline := range baselines {
		experiment := experimentByID[baseline.ExperimentID]
		for _, defID := range experimentDefinitionIDs(experiment) {
			latestBaseline[defID] = baseline
		}
		if experiment.Suite.ID != "" {
			latestBaseline["suite:"+safeQualityCatalogID(experiment.Suite.ID)] = baseline
		}
	}

	for i := range definitions {
		q := definitions[i].Quality
		if q == nil || len(q.AffectedEvalIDs)+len(q.AffectedSuiteIDs) == 0 {
			continue
		}
		drift := store.CatalogQualityDrift{Evals: []store.CatalogQualityDriftRow{}, Suites: []store.CatalogQualityDriftRow{}}
		for _, evalID := range q.AffectedEvalIDs {
			for _, defID := range candidateQualityDefinitionIDs("eval.prompt", evalID) {
				if row, ok := driftRowForDefinition(evalID, defByID[defID], latestBaseline[defID], experimentByID); ok {
					drift.Evals = append(drift.Evals, row)
					break
				}
			}
		}
		for _, suiteID := range q.AffectedSuiteIDs {
			defID := "suite:" + safeQualityCatalogID(suiteID)
			if row, ok := driftRowForDefinition(suiteID, defByID[defID], latestBaseline[defID], experimentByID); ok {
				drift.Suites = append(drift.Suites, row)
			}
		}
		if len(drift.Evals) > 0 || len(drift.Suites) > 0 {
			q.Drift = &drift
		}
	}
}

func addQualityLintFindings(catalog *store.CatalogData) {
	if catalog == nil {
		return
	}
	existing := make(map[string]bool, len(catalog.LintFindings))
	for _, finding := range catalog.LintFindings {
		existing[finding.ID] = true
	}
	for _, def := range catalog.Definitions {
		q := def.Quality
		if q == nil || len(q.ExperimentIDs) == 0 || len(q.BaselineIDs) > 0 {
			continue
		}
		finding := missingBaselineLintFinding(def, q)
		if finding.ID == "" || existing[finding.ID] {
			continue
		}
		catalog.LintFindings = append(catalog.LintFindings, finding)
		existing[finding.ID] = true
	}
}

type catalogLintSuppression struct {
	file   string
	line   int
	scope  string
	ruleID string
	used   bool
}

func applyCatalogLintPolicy(catalog *store.CatalogData) {
	if catalog == nil || len(catalog.LintFindings) == 0 {
		return
	}
	findings := catalog.LintFindings
	findings = applyCatalogLintRuleConfig(findings, catalog.Lint)
	findings, usedSuppressions := applyCatalogLintSourceSuppressions(findings, catalogLintSourceFiles(*catalog))
	catalog.Diagnostics = removeCatalogLintUnusedSuppressionDiagnostics(catalog.Diagnostics, usedSuppressions)
	catalog.LintFindings = selectCatalogLintProfile(findings, catalog.Lint)
}

func applyCatalogLintRuleConfig(findings []store.CatalogLintFinding, config *store.CatalogLintConfig) []store.CatalogLintFinding {
	if config == nil || len(config.Rules) == 0 {
		return findings
	}
	selected := make([]store.CatalogLintFinding, 0, len(findings))
	for _, finding := range findings {
		ruleConfig, ok := config.Rules[finding.RuleID]
		if ok && ruleConfig.Enabled != nil && !*ruleConfig.Enabled {
			continue
		}
		if ok && ruleConfig.Severity != "" {
			finding.Severity = ruleConfig.Severity
		}
		selected = append(selected, finding)
	}
	return selected
}

func selectCatalogLintProfile(findings []store.CatalogLintFinding, config *store.CatalogLintConfig) []store.CatalogLintFinding {
	profile := "recommended"
	if config != nil && config.Profile != "" {
		profile = config.Profile
	}
	if profile == "off" {
		return []store.CatalogLintFinding{}
	}
	selected := make([]store.CatalogLintFinding, 0, len(findings))
	for _, finding := range findings {
		if finding.Suppressed {
			continue
		}
		if !containsQualityString(finding.Profiles, profile) {
			continue
		}
		selected = append(selected, finding)
	}
	return selected
}

func applyCatalogLintSourceSuppressions(findings []store.CatalogLintFinding, files []string) ([]store.CatalogLintFinding, []catalogLintSuppression) {
	suppressions := parseCatalogLintSuppressions(files)
	if len(suppressions) == 0 {
		return findings, nil
	}
	selected := make([]store.CatalogLintFinding, 0, len(findings))
	for _, finding := range findings {
		matched := false
		for i := range suppressions {
			if catalogLintSuppressionMatches(suppressions[i], finding) {
				suppressions[i].used = true
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		selected = append(selected, finding)
	}
	used := make([]catalogLintSuppression, 0)
	for _, suppression := range suppressions {
		if suppression.used {
			used = append(used, suppression)
		}
	}
	return selected, used
}

func catalogLintSourceFiles(catalog store.CatalogData) []string {
	files := make([]string, 0, len(catalog.Sources)+len(catalog.Definitions))
	seen := map[string]bool{}
	add := func(file string) {
		if file == "" || seen[file] {
			return
		}
		seen[file] = true
		files = append(files, file)
	}
	for _, source := range catalog.Sources {
		add(source.File)
	}
	for _, definition := range catalog.Definitions {
		if definition.Source != nil {
			add(definition.Source.File)
		}
		for _, ref := range definition.SourceRefs {
			add(ref.Source.File)
		}
	}
	return files
}

func parseCatalogLintSuppressions(files []string) []catalogLintSuppression {
	suppressions := []catalogLintSuppression{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		lines := strings.Split(string(raw), "\n")
		for index, text := range lines {
			match := catalogLintSuppressionPattern.FindStringSubmatchIndex(text)
			if match == nil {
				continue
			}
			scope := text[match[2]:match[3]]
			ruleID := text[match[4]:match[5]]
			line := index + 1
			suppressions = append(suppressions, catalogLintSuppression{
				file:   file,
				line:   line,
				scope:  scope,
				ruleID: ruleID,
			})
		}
	}
	return suppressions
}

func catalogLintSuppressionMatches(suppression catalogLintSuppression, finding store.CatalogLintFinding) bool {
	if finding.RuleID != suppression.ruleID {
		return false
	}
	if finding.Source == nil || finding.Source.File != suppression.file {
		return false
	}
	switch suppression.scope {
	case "file":
		return true
	case "line":
		return finding.Source.Line == suppression.line
	default:
		return finding.Source.Line == suppression.line+1
	}
}

func removeCatalogLintUnusedSuppressionDiagnostics(diagnostics []store.CatalogDiagnostic, suppressions []catalogLintSuppression) []store.CatalogDiagnostic {
	if len(diagnostics) == 0 || len(suppressions) == 0 {
		return diagnostics
	}
	selected := make([]store.CatalogDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "catalog.lint_unused_suppression" && catalogLintDiagnosticMatchesUsedSuppression(diagnostic, suppressions) {
			continue
		}
		selected = append(selected, diagnostic)
	}
	return selected
}

func catalogLintDiagnosticMatchesUsedSuppression(diagnostic store.CatalogDiagnostic, suppressions []catalogLintSuppression) bool {
	if diagnostic.Source == nil {
		return false
	}
	for _, suppression := range suppressions {
		if diagnostic.Source.File == suppression.file && diagnostic.Source.Line == suppression.line {
			return true
		}
	}
	return false
}

func missingBaselineLintFinding(def store.ProjectDefinition, q *store.CatalogQuality) store.CatalogLintFinding {
	if q == nil {
		return store.CatalogLintFinding{}
	}
	docsURL := "/docs/reference/crux-core/catalog-lints/quality-missing-baseline"
	suppression := "// crux-lint-disable-next-line quality.missing_baseline -- reason"
	data := map[string]interface{}{
		"experimentIds":   q.ExperimentIDs,
		"experimentCount": q.ExperimentCount,
	}
	if q.PassRate != nil {
		data["passRate"] = *q.PassRate
	}
	if q.LastRunID != "" {
		data["lastRunId"] = q.LastRunID
	}
	return store.CatalogLintFinding{
		ID:                    "lint:quality.missing_baseline:" + safeQualityCatalogID(def.ID),
		Severity:              "info",
		RuleID:                "quality.missing_baseline",
		Category:              "quality",
		Maturity:              "preview",
		Confidence:            "high",
		Profiles:              []string{"recommended", "strict"},
		Title:                 "Quality target has no baseline",
		Message:               def.Name + " has experiment history but no promoted baseline.",
		Rationale:             "A promoted baseline lets you compare future runs against known behavior and understand whether authored AI changes are regressions or improvements.",
		Impact:                "Without a baseline, quality history is visible but drift and regression checks cannot anchor to a known good run.",
		Source:                def.Source,
		PrimaryDefinitionID:   def.ID,
		RelatedDefinitionIDs:  []string{},
		AffectedDefinitionIDs: []string{def.ID},
		Evidence: []store.CatalogLintEvidence{{
			Kind:         "quality",
			Label:        "Experiment history without baseline",
			Description:  "This definition has completed experiment data but no baseline quality record.",
			DefinitionID: def.ID,
			Source:       def.Source,
			Data:         data,
		}},
		Fixes: []store.CatalogLintFix{
			{
				Title:       "Promote a baseline",
				Description: "Promote a trusted experiment or variant as the baseline for this definition so future changes can be compared.",
				Kind:        "manual",
			},
			{
				Title:       "Read rule docs",
				Description: "Open the rule documentation for examples, trade-offs, and suppression guidance.",
				Kind:        "docs",
				DocsURL:     docsURL,
			},
			{
				Title:       "Suppress intentionally",
				Description: "Use a rule-specific source comment only when this missing baseline is intentional and documented.",
				Kind:        "suppress",
				Suppression: suppression,
			},
		},
		DocsURL: docsURL,
		Suppression: &store.CatalogLintSuppression{
			Supported: true,
			Directive: suppression,
			Scope:     "next-line",
		},
	}
}

func driftRowForDefinition(id string, def store.ProjectDefinition, baseline qualityBaselineRecord, experimentByID map[string]qualityExperimentRecord) (store.CatalogQualityDriftRow, bool) {
	if def.ID == "" || def.Quality == nil || def.Quality.PassRate == nil || baseline.ExperimentID == "" {
		return store.CatalogQualityDriftRow{}, false
	}
	baselineExperiment := experimentByID[baseline.ExperimentID]
	baselinePassRate, ok := baselinePassRateForDefinition(def, baseline, baselineExperiment)
	if !ok {
		return store.CatalogQualityDriftRow{}, false
	}
	passRate := *def.Quality.PassRate
	return store.CatalogQualityDriftRow{
		ID:                   id,
		PassRate:             passRate,
		Runs:                 def.Quality.RunCount,
		BaselineExperimentID: baseline.ExperimentID,
		BaselinePassRate:     baselinePassRate,
		DriftPp:              (passRate - baselinePassRate) * 100,
	}, true
}

func baselinePassRateForDefinition(def store.ProjectDefinition, baseline qualityBaselineRecord, experiment qualityExperimentRecord) (float64, bool) {
	if def.Kind == "suite" && experiment.Summary.Total > 0 {
		return float64(experiment.Summary.Passed) / float64(experiment.Summary.Total), true
	}
	for _, variant := range experiment.Variants {
		if baseline.VariantID != nil && variant.ID != *baseline.VariantID {
			continue
		}
		for _, candidate := range qualityTargetDefinitionIDs(variant.TargetID) {
			if candidate == def.ID {
				if variant.PassRate != nil {
					return *variant.PassRate, true
				}
				if experiment.Summary.Total > 0 {
					return float64(experiment.Summary.Passed) / float64(experiment.Summary.Total), true
				}
			}
		}
	}
	return 0, false
}

func candidateQualityDefinitionIDs(prefix, id string) []string {
	safe := safeQualityCatalogID(id)
	out := []string{prefix + ":" + safe}
	if safe != id {
		out = append(out, prefix+":"+id)
	}
	return out
}

func definitionLocalID(defID string) string {
	if index := strings.Index(defID, ":"); index >= 0 && index < len(defID)-1 {
		return defID[index+1:]
	}
	return defID
}

func ensureDefinitionQuality(def *store.ProjectDefinition) *store.CatalogQuality {
	if def.Quality == nil {
		def.Quality = &store.CatalogQuality{}
	}
	return def.Quality
}

func qualityTargetDefinitionIDs(targetID string) []string {
	safe := safeQualityCatalogID(targetID)
	if safe == "" {
		return nil
	}
	return []string{
		safe,
		"prompt:" + safe,
		"flow:" + safe,
		"agent:" + safe,
		"rag.pipeline:" + safe,
		"tool:" + safe,
	}
}

func experimentDefinitionIDs(experiment qualityExperimentRecord) []string {
	defIDs := []string{}
	if experiment.Suite.ID != "" {
		defIDs = append(defIDs, "suite:"+safeQualityCatalogID(experiment.Suite.ID))
	}
	for _, variant := range experiment.Variants {
		defIDs = append(defIDs, qualityTargetDefinitionIDs(variant.TargetID)...)
	}
	return defIDs
}

func safeQualityCatalogID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	safe := qualityCatalogSafeIDPattern.ReplaceAllString(trimmed, "-")
	return strings.Trim(safe, "-")
}

func appendQualityUniqueString(values []string, value string) []string {
	if value == "" {
		return values
	}
	if containsQualityString(values, value) {
		return values
	}
	return append(values, value)
}

func containsQualityString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func parseCatalogQualityTime(value string) int64 {
	if value == "" {
		return 0
	}
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t.UnixMilli()
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.UnixMilli()
	}
	return 0
}
