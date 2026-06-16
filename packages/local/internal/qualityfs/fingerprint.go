package qualityfs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (f *FS) fingerprint(opts snapshotOptions) (string, bool) {
	var builder strings.Builder
	addPath := func(path string) bool {
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				builder.WriteString(path)
				builder.WriteString(":missing\n")
				return true
			}
			return false
		}
		builder.WriteString(path)
		builder.WriteByte(':')
		builder.WriteString(info.ModTime().UTC().Format(time.RFC3339Nano))
		builder.WriteByte(':')
		builder.WriteString(fmt.Sprint(info.Size()))
		builder.WriteByte('\n')
		return true
	}
	for _, kind := range []Kind{KindExperiments, KindSuites, KindBaselines, KindComparisons} {
		if !fingerprintDir(filepath.Join(f.dir, string(kind)), &builder) {
			return "", false
		}
	}
	if !fingerprintDir(filepath.Join(f.dir, "cassettes"), &builder) {
		return "", false
	}
	for _, stream := range []Stream{
		StreamFeedbackInbox,
		StreamFeedbackAnnotations,
		StreamInsightStatuses,
		StreamInsightSilences,
		StreamCassetteIssues,
	} {
		if !addPath(filepath.Join(f.dir, filepath.FromSlash(string(stream)))) {
			return "", false
		}
	}
	paths, err := discoverProjectCassettePaths(opts.projectRoot)
	if err != nil {
		return "", false
	}
	for _, path := range paths {
		if !addPath(path) {
			return "", false
		}
	}
	return builder.String(), true
}

func fingerprintDir(dir string, builder *strings.Builder) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			builder.WriteString(dir)
			builder.WriteString(":missing\n")
			return true
		}
		return false
	}
	builder.WriteString(dir)
	builder.WriteString(":dir\n")
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return false
		}
		builder.WriteString(entry.Name())
		builder.WriteByte(':')
		if entry.IsDir() {
			builder.WriteString("dir")
		} else {
			builder.WriteString(info.ModTime().UTC().Format(time.RFC3339Nano))
			builder.WriteByte(':')
			builder.WriteString(fmt.Sprint(info.Size()))
		}
		builder.WriteByte('\n')
	}
	return true
}
