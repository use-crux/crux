package bridge

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRevisionsBumpDomainsFromInspectEvent(t *testing.T) {
	tests := []struct {
		name string
		ev   api.InspectEvent
		want Domains
	}{
		{name: "run", ev: api.InspectEvent{Kind: "run"}, want: NewDomains(DomainRuns, DomainActivity)},
		{name: "observability", ev: api.InspectEvent{Kind: "observability"}, want: NewDomains(DomainRuns, DomainActivity)},
		{name: "insight", ev: api.InspectEvent{Kind: "insight"}, want: NewDomains(DomainInsights, DomainActivity)},
		{name: "eval", ev: api.InspectEvent{Kind: "eval"}, want: NewDomains(DomainActivity)},
		{name: "baseline", ev: api.InspectEvent{Kind: "baseline"}, want: NewDomains(DomainBaselines, DomainContext, DomainActivity)},
		{name: "feedback", ev: api.InspectEvent{Kind: "feedback"}, want: NewDomains(DomainFeedback, DomainActivity)},
		{name: "context", ev: api.InspectEvent{Kind: "context"}, want: NewDomains(DomainContext)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var revs Revisions
			got := revs.BumpInspect(tt.ev)
			if !got.Equal(tt.want) {
				t.Fatalf("domains = %v, want %v", got.List(), tt.want.List())
			}
		})
	}
}
