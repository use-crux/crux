package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type sharedStaticIndexCacheIdentityFixture struct {
	StaticParseCacheEpoch string `json:"staticParseCacheEpoch"`
}

func TestStaticIndexCacheEpochMatchesSharedFixture(t *testing.T) {
	var fixture sharedStaticIndexCacheIdentityFixture
	readStaticIndexCacheIdentityFixture(t, &fixture)

	if Epoch != fixture.StaticParseCacheEpoch {
		t.Fatalf("Static Index cache epoch = %q, want shared fixture %q", Epoch, fixture.StaticParseCacheEpoch)
	}
}

func readStaticIndexCacheIdentityFixture(t testing.TB, out *sharedStaticIndexCacheIdentityFixture) {
	t.Helper()
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"..",
		"indexer",
		"src",
		"contracts",
		"fixtures",
		"static-index-cache-identity.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared Static Index cache identity fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode shared Static Index cache identity fixture: %v", err)
	}
}
