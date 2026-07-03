package bridge

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRevisionsBumpDomainsFromQualityEvent(t *testing.T) {
	tests := []struct {
		name string
		ev   api.QualityEvent
		want Domains
	}{
		{name: "run", ev: api.QualityEvent{Kind: "run"}, want: NewDomains(DomainRuns, DomainActivity)},
		{name: "observability", ev: api.QualityEvent{Kind: "observability"}, want: NewDomains(DomainRuns, DomainActivity)},
		{name: "insight", ev: api.QualityEvent{Kind: "insight"}, want: NewDomains(DomainInsights, DomainActivity)},
		{name: "experiment", ev: api.QualityEvent{Kind: "experiment"}, want: NewDomains(DomainExperiments, DomainActivity)},
		{name: "baseline", ev: api.QualityEvent{Kind: "baseline"}, want: NewDomains(DomainBaselines, DomainContext, DomainActivity)},
		{name: "feedback", ev: api.QualityEvent{Kind: "feedback"}, want: NewDomains(DomainFeedback, DomainActivity)},
		{name: "cassette", ev: api.QualityEvent{Kind: "cassette"}, want: NewDomains(DomainCassettes, DomainActivity)},
		{name: "suite", ev: api.QualityEvent{Kind: "suite"}, want: NewDomains(DomainSuites, DomainActivity)},
		{name: "context", ev: api.QualityEvent{Kind: "context"}, want: NewDomains(DomainContext)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var revs Revisions
			got := revs.BumpQuality(tt.ev)
			if !got.Equal(tt.want) {
				t.Fatalf("domains = %v, want %v", got.List(), tt.want.List())
			}
		})
	}
}
