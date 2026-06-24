package staticplan

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcache"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func TestProjectNativeStaticPlanReportsSubphaseTimings(t *testing.T) {
	t.Setenv(staticcache.StatusEnv, "1")

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'timed-plan' })\n"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	result, err := BuildWithTimings(root, "timed-plan", projectindex.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("BuildWithTimings error = %v", err)
	}
	names := planTimingNames(result.Timings)
	for _, name := range []string{
		TimingFileSelection,
		TimingSourceGraph,
		TimingCacheStatus,
	} {
		if !slices.Contains(names, name) {
			t.Fatalf("timing names = %v, want %s", names, name)
		}
	}
}

func planTimingNames(timings []projectindex.ProjectIndexPhaseTiming) []string {
	names := make([]string, 0, len(timings))
	for _, timing := range timings {
		names = append(names, timing.Name)
	}
	return names
}
