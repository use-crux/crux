package qualityfs

import (
	"encoding/json"
	"errors"
)

type SnapshotOption func(*snapshotOptions)

type snapshotOptions struct {
	projectRoot string
}

func Load(path string, opts ...SnapshotOption) (*Snapshot, error) {
	return Open(path).Snapshot(opts...)
}

func WithProjectCassettes(projectRoot string) SnapshotOption {
	return func(opts *snapshotOptions) {
		opts.projectRoot = projectRoot
	}
}

type Snapshot struct {
	Experiments []Experiment
	Suites      []Suite
	Baselines   []Baseline
	Comparisons []Comparison
	Cassettes   []Cassette
	Feedback    []Feedback
	Silences    []InsightSilence
	Statuses    map[string]InsightStatus

	ByTrace  TraceJoins
	ByTarget TargetJoins
	ByID     IDJoins
}

type TraceJoins struct {
	ExperimentIDs map[string][]string
	FeedbackIDs   map[string][]string
	Scores        map[string]ScoreSummary
}

type TargetJoins struct {
	CassettePaths map[string][]string
}

type IDJoins struct {
	Experiments map[string]Experiment
	Baselines   map[string]Baseline
}

func (f *FS) Snapshot(opts ...SnapshotOption) (*Snapshot, error) {
	if f == nil {
		f = Open("")
	}
	options := snapshotOptions{}
	for _, opt := range opts {
		opt(&options)
	}
	fp, fpOK := f.fingerprint(options)
	if fpOK {
		if cached := f.cache.Load(); cached != nil && cached.fingerprint == fp {
			return cloneSnapshot(cached.snapshot), cached.err
		}
	}
	snapshot, err := f.loadSnapshot(options)
	if fpOK {
		f.cache.Store(&cachedSnapshot{fingerprint: fp, snapshot: snapshot, err: err})
	}
	return cloneSnapshot(snapshot), err
}

func cloneSnapshot(snapshot *Snapshot) *Snapshot {
	if snapshot == nil {
		return nil
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		return snapshot
	}
	var out Snapshot
	if err := json.Unmarshal(data, &out); err != nil {
		return snapshot
	}
	return &out
}

func (f *FS) loadSnapshot(opts snapshotOptions) (*Snapshot, error) {
	snapshot := &Snapshot{
		Statuses: map[string]InsightStatus{},
		ByTrace: TraceJoins{
			ExperimentIDs: map[string][]string{},
			FeedbackIDs:   map[string][]string{},
			Scores:        map[string]ScoreSummary{},
		},
		ByTarget: TargetJoins{CassettePaths: map[string][]string{}},
		ByID: IDJoins{
			Experiments: map[string]Experiment{},
			Baselines:   map[string]Baseline{},
		},
	}
	var errs []error

	if records, err := f.readExperiments(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Experiments = records
	}
	if records, err := f.readSuites(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Suites = records
	}
	if records, err := f.readBaselines(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Baselines = records
	}
	if records, err := f.readComparisons(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Comparisons = records
	}
	if records, err := f.readFeedback(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Feedback = records
	}
	if records, err := f.readInsightSilences(true); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Silences = records
	}
	if records, err := f.readInsightStatuses(); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Statuses = records
	}
	if records, err := f.readCassettesForProject(opts.projectRoot); err != nil {
		errs = append(errs, err)
	} else {
		snapshot.Cassettes = records
	}

	snapshot.buildJoins()
	return snapshot, errors.Join(errs...)
}

func (s *Snapshot) buildJoins() {
	if s.Statuses == nil {
		s.Statuses = map[string]InsightStatus{}
	}
	if s.ByTrace.ExperimentIDs == nil {
		s.ByTrace.ExperimentIDs = map[string][]string{}
	}
	if s.ByTrace.FeedbackIDs == nil {
		s.ByTrace.FeedbackIDs = map[string][]string{}
	}
	if s.ByTrace.Scores == nil {
		s.ByTrace.Scores = map[string]ScoreSummary{}
	}
	if s.ByTarget.CassettePaths == nil {
		s.ByTarget.CassettePaths = map[string][]string{}
	}
	if s.ByID.Experiments == nil {
		s.ByID.Experiments = map[string]Experiment{}
	}
	if s.ByID.Baselines == nil {
		s.ByID.Baselines = map[string]Baseline{}
	}
	for _, experiment := range s.Experiments {
		if experiment.ID != "" {
			s.ByID.Experiments[experiment.ID] = experiment
		}
		for _, testCase := range experiment.Cases {
			if testCase.TraceID == "" {
				continue
			}
			s.ByTrace.ExperimentIDs[testCase.TraceID] = appendUniqueString(s.ByTrace.ExperimentIDs[testCase.TraceID], experiment.ID)
			for _, score := range testCase.Scores {
				if score.Kind != "numeric" || score.Value == nil {
					continue
				}
				value := *score.Value
				s.ByTrace.Scores[testCase.TraceID] = ScoreSummary{Name: score.Name, Value: &value}
				break
			}
		}
	}
	for _, baseline := range s.Baselines {
		if baseline.ID != "" {
			s.ByID.Baselines[baseline.ID] = baseline
		}
	}
	for _, feedback := range s.Feedback {
		if feedback.TraceID == nil || *feedback.TraceID == "" {
			continue
		}
		s.ByTrace.FeedbackIDs[*feedback.TraceID] = appendUniqueString(s.ByTrace.FeedbackIDs[*feedback.TraceID], feedback.ID)
	}
	for _, cassette := range s.Cassettes {
		for _, entry := range cassette.Entries {
			if entry.TargetID == "" || cassette.Path == "" {
				continue
			}
			s.ByTarget.CassettePaths[entry.TargetID] = appendUniqueString(s.ByTarget.CassettePaths[entry.TargetID], cassette.Path)
		}
	}
}
