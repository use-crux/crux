package bridge

import (
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Domain names a read-model area that can become stale after a live event.
type Domain string

const (
	DomainRuns      Domain = "runs"
	DomainInsights  Domain = "insights"
	DomainBaselines Domain = "baselines"
	DomainFeedback  Domain = "feedback"
	DomainActivity  Domain = "activity"
	DomainIndex     Domain = "index"
	DomainContext   Domain = "context"
)

// Domains is a small set used by screens to declare interest in changed data.
type Domains map[Domain]struct{}

// NewDomains constructs a domain set.
func NewDomains(domains ...Domain) Domains {
	set := Domains{}
	for _, domain := range domains {
		set.Add(domain)
	}
	return set
}

// Add inserts a domain into the set.
func (d Domains) Add(domain Domain) {
	if domain == "" {
		return
	}
	d[domain] = struct{}{}
}

// AddAll inserts every domain from other.
func (d Domains) AddAll(other Domains) {
	for domain := range other {
		d.Add(domain)
	}
}

// Has reports whether the set contains domain.
func (d Domains) Has(domain Domain) bool {
	_, ok := d[domain]
	return ok
}

// Intersects reports whether any domain is shared with other.
func (d Domains) Intersects(other Domains) bool {
	for domain := range other {
		if d.Has(domain) {
			return true
		}
	}
	return false
}

// Empty reports whether no domains are present.
func (d Domains) Empty() bool { return len(d) == 0 }

// Equal compares two domain sets.
func (d Domains) Equal(other Domains) bool {
	if len(d) != len(other) {
		return false
	}
	for domain := range d {
		if !other.Has(domain) {
			return false
		}
	}
	return true
}

// List returns a deterministic view of the set for tests and logs.
func (d Domains) List() []Domain {
	out := make([]Domain, 0, len(d))
	for domain := range d {
		out = append(out, domain)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// Revisions carries monotonic counters for each live data domain.
type Revisions struct {
	Runs      uint64
	Insights  uint64
	Baselines uint64
	Feedback  uint64
	Activity  uint64
	Index     uint64
	Context   uint64
}

// BumpInspect records the domains affected by ev and returns that domain set.
func (r *Revisions) BumpInspect(ev api.InspectEvent) Domains {
	return r.bump(DomainsForInspectEvent(ev).List()...)
}

// DomainsForInspectEvent classifies one typed event into affected read-model
// domains without advancing revision counters.
func DomainsForInspectEvent(ev api.InspectEvent) Domains {
	return NewDomains(domainsForInspectEvent(ev)...)
}

// BumpStore records a generic store change without forcing a context refetch.
func (r *Revisions) BumpStore() Domains { return nil }

// BumpIndex records a Project Index change.
func (r *Revisions) BumpIndex() Domains { return r.bump(DomainIndex) }

func (r *Revisions) bump(domains ...Domain) Domains {
	changed := NewDomains(domains...)
	for domain := range changed {
		switch domain {
		case DomainRuns:
			r.Runs++
		case DomainInsights:
			r.Insights++
		case DomainBaselines:
			r.Baselines++
		case DomainFeedback:
			r.Feedback++
		case DomainActivity:
			r.Activity++
		case DomainIndex:
			r.Index++
		case DomainContext:
			r.Context++
		}
	}
	return changed
}

func domainsForInspectEvent(ev api.InspectEvent) []Domain {
	kind := strings.ToLower(ev.Kind)
	action := strings.ToLower(ev.Action)
	switch {
	case strings.Contains(kind, "refresh") && strings.Contains(action, "observability"):
		return []Domain{DomainRuns, DomainActivity}
	case strings.Contains(kind, "observability"), strings.Contains(kind, "run"), strings.Contains(kind, "trace"):
		return []Domain{DomainRuns, DomainActivity}
	case strings.Contains(kind, "insight"):
		return []Domain{DomainInsights, DomainActivity}
	case strings.Contains(kind, "eval"):
		return []Domain{DomainActivity}
	case strings.Contains(kind, "baseline"):
		return []Domain{DomainBaselines, DomainContext, DomainActivity}
	case strings.Contains(kind, "feedback"):
		return []Domain{DomainFeedback, DomainActivity}
	case strings.Contains(kind, "index"):
		return []Domain{DomainIndex}
	case strings.Contains(kind, "context"), strings.Contains(kind, "target"), strings.Contains(action, "promoted"):
		return []Domain{DomainContext}
	default:
		return []Domain{DomainActivity}
	}
}
