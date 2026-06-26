package planner

import (
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

type signalMatcher struct {
	patterns []signalPattern
}

type signalPattern struct {
	hint    string
	pattern *regexp.Regexp
}

func signalMatcherForCallNames(callNames []string) signalMatcher {
	patterns := make([]signalPattern, 0, len(cruxSignalPatterns)+len(defaultCallNames)+len(callNames))
	for _, pattern := range cruxSignalPatterns {
		patterns = append(patterns, signalPattern{
			hint:    signalPatternHint(pattern.String()),
			pattern: pattern,
		})
	}
	seen := map[string]bool{}
	appendName := func(name string) {
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		patterns = append(patterns, signalPattern{
			hint:    name,
			pattern: regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\s*\(`),
		})
	}
	for _, name := range defaultCallNames {
		appendName(name)
	}
	for _, name := range callNames {
		appendName(name)
	}
	return signalMatcher{patterns: patterns}
}

func (m signalMatcher) HasCruxInterest(sample string) bool {
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

func signalPatternHint(pattern string) string {
	if strings.Contains(pattern, "@use-crux/") {
		return "@use-crux/"
	}
	names := append([]string(nil), defaultCallNames...)
	names = append(names, "workingState", "evaluation", "suite")
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
	for _, name := range names {
		if strings.Contains(pattern, name) {
			return name
		}
	}
	return ""
}

func classifyCandidates(
	files []string,
	callNames []string,
) []candidateClassification {
	return classifyCandidatesWithCache(files, callNames, nil)
}

func classifyCandidatesWithCache(
	files []string,
	callNames []string,
	discoveryCache *discoveryCache,
) []candidateClassification {
	classifications := make([]candidateClassification, len(files))
	if len(files) == 0 {
		return classifications
	}
	matcher := signalMatcherForCallNames(callNames)
	callNamesKey := discoveryCallNamesKey(callNames)
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
				fingerprint, fingerprintOK := discoveryFingerprint(file)
				if cached, ok := discoveryCache.CachedClassificationWithFingerprint(file, callNamesKey, fingerprint, fingerprintOK); ok {
					classifications[fileIndex] = cached
					continue
				}
				classification := classifyCandidateWithMatcherAndFingerprint(
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
