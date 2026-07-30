package observability

import (
	"path/filepath"
	"testing"
	"time"
)

func TestOpenServiceWithOptionsUsesInjectedEvidenceClock(t *testing.T) {
	now := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	service, err := OpenServiceWithOptions(
		t.Context(),
		filepath.Join(t.TempDir(), "observability.sqlite"),
		OpenServiceOptions{
			Now: func() time.Time { return now },
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })

	if got := service.evidenceNow(); !got.Equal(now) {
		t.Fatalf("evidence clock = %s, want %s", got, now)
	}
}
