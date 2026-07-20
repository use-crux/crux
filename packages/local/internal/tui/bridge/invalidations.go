package bridge

// ResourceName identifies one independently refreshable TUI projection.
type ResourceName string

const (
	OverviewSummaryResource  ResourceName = "overview:summary"
	OverviewInsightsResource ResourceName = "overview:insights"
	OverviewRunsResource     ResourceName = "overview:runs"
	OverviewActivityResource ResourceName = "overview:activity"
	RunsListResource         ResourceName = "runs:list"
	RunsAnyDetailResource    ResourceName = "runs:detail:*"
	IndexSnapshotResource    ResourceName = "index:snapshot"
)

// RunsDetailResource identifies one exact selected-run detail projection.
func RunsDetailResource(runID string) ResourceName {
	return ResourceName("runs:detail:" + runID)
}

// Invalidations retains the newest revision floor for each named resource.
// Revisions are meaningful only within the named resource that owns them.
type Invalidations map[ResourceName]uint64

// Add invalidates name at revision, retaining the highest observed floor.
func (i Invalidations) Add(name ResourceName, revision uint64) {
	if name == "" {
		return
	}
	if current, ok := i[name]; !ok || revision > current {
		i[name] = revision
	}
}

// AddAll merges another invalidation set.
func (i Invalidations) AddAll(other Invalidations) {
	for name, revision := range other {
		i.Add(name, revision)
	}
}

// Revision returns a resource's newest revision floor and whether it is
// invalidated.
func (i Invalidations) Revision(name ResourceName) (uint64, bool) {
	revision, ok := i[name]
	return revision, ok
}
