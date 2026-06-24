package projectindexer

import (
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

type projectNativeStaticSignalMatcher struct {
	patterns []projectNativeStaticSignalPattern
}

type projectNativeStaticSignalPattern struct {
	hint    string
	pattern *regexp.Regexp
}

func projectNativeStaticSignalMatcherForCallNames(callNames []string) projectNativeStaticSignalMatcher {
	patterns := make([]projectNativeStaticSignalPattern, 0, len(projectNativeStaticCruxSignalPatterns)+len(projectNativeStaticDefaultCallNames)+len(callNames))
	for _, pattern := range projectNativeStaticCruxSignalPatterns {
		patterns = append(patterns, projectNativeStaticSignalPattern{
			hint:    projectNativeStaticSignalPatternHint(pattern.String()),
			pattern: pattern,
		})
	}
	seen := map[string]bool{}
	appendName := func(name string) {
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		patterns = append(patterns, projectNativeStaticSignalPattern{
			hint:    name,
			pattern: regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\s*\(`),
		})
	}
	for _, name := range projectNativeStaticDefaultCallNames {
		appendName(name)
	}
	for _, name := range callNames {
		appendName(name)
	}
	return projectNativeStaticSignalMatcher{patterns: patterns}
}

func (m projectNativeStaticSignalMatcher) HasCruxInterest(sample string) bool {
	for _, pattern := range m.patterns {
		if pattern.hint != "" && !strings.Contains(sample, pattern.hint) {
			continue
		}
		if pattern.pattern.MatchString(sample) {
			return true
		}
	}
	return false
}

func projectNativeStaticSignalPatternHint(pattern string) string {
	if strings.Contains(pattern, "@crux/") {
		return "@crux/"
	}
	names := append([]string(nil), projectNativeStaticDefaultCallNames...)
	names = append(names, "workingState", "evaluation", "suite")
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
	for _, name := range names {
		if strings.Contains(pattern, name) {
			return name
		}
	}
	return ""
}

func projectNativeStaticClassifyCandidates(
	files []string,
	callNames []string,
) []projectNativeStaticCandidateClassification {
	return projectNativeStaticClassifyCandidatesWithCache(files, callNames, nil)
}

func projectNativeStaticClassifyCandidatesWithCache(
	files []string,
	callNames []string,
	discoveryCache *projectNativeStaticDiscoveryCache,
) []projectNativeStaticCandidateClassification {
	classifications := make([]projectNativeStaticCandidateClassification, len(files))
	if len(files) == 0 {
		return classifications
	}
	matcher := projectNativeStaticSignalMatcherForCallNames(callNames)
	callNamesKey := projectNativeStaticDiscoveryCallNamesKey(callNames)
	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(files) {
		workerCount = len(files)
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for fileIndex := range jobs {
				file := files[fileIndex]
				fingerprint, fingerprintOK := projectNativeStaticDiscoveryFingerprint(file)
				if cached, ok := discoveryCache.CachedClassificationWithFingerprint(file, callNamesKey, fingerprint, fingerprintOK); ok {
					classifications[fileIndex] = cached
					continue
				}
				classification := projectNativeStaticClassifyCandidateWithMatcherAndFingerprint(
					file,
					matcher,
					fingerprint,
					fingerprintOK,
				)
				discoveryCache.StoreClassificationWithFingerprint(file, callNamesKey, classification, fingerprint, fingerprintOK)
				classifications[fileIndex] = classification
			}
		}()
	}
	for index := range files {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return classifications
}
