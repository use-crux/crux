package frontend

import "testing"

func TestAdaptivePoolCount(t *testing.T) {
	tests := []struct {
		name        string
		requests    int
		maxWorkers  int
		wantWorkers int
	}{
		{name: "single", requests: 1, maxWorkers: 4, wantWorkers: 1},
		{name: "small", requests: 32, maxWorkers: 4, wantWorkers: 1},
		{name: "current repo sized", requests: 422, maxWorkers: 4, wantWorkers: 1},
		{name: "medium", requests: 1024, maxWorkers: 4, wantWorkers: 2},
		{name: "large", requests: 2400, maxWorkers: 4, wantWorkers: 4},
		{name: "clamped medium", requests: 1024, maxWorkers: 1, wantWorkers: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := AdaptiveWorkerCount(test.requests, test.maxWorkers); got != test.wantWorkers {
				t.Fatalf("AdaptiveWorkerCount(%d, %d) = %d, want %d", test.requests, test.maxWorkers, got, test.wantWorkers)
			}
		})
	}
}

func TestPoolActiveWorkerCount(t *testing.T) {
	adaptive := NewAdaptivePool(4, "")
	if got := adaptive.ActiveWorkerCount(16); got != 1 {
		t.Fatalf("adaptive active workers for small project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(128); got != 1 {
		t.Fatalf("adaptive active workers for small project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(422); got != 1 {
		t.Fatalf("adaptive active workers for current repo sized project = %d, want 1", got)
	}
	if got := adaptive.ActiveWorkerCount(1024); got != 2 {
		t.Fatalf("adaptive active workers for medium project = %d, want 2", got)
	}
	if got := adaptive.ActiveWorkerCount(2400); got != 4 {
		t.Fatalf("adaptive active workers for large project = %d, want 4", got)
	}
	fixed := NewPool(4, "")
	if got := fixed.ActiveWorkerCount(16); got != 4 {
		t.Fatalf("fixed active workers = %d, want 4", got)
	}
	if got := fixed.ActiveWorkerCount(2); got != 2 {
		t.Fatalf("fixed active workers should clamp to requests = %d, want 2", got)
	}
}
