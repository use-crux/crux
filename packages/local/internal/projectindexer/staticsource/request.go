package staticsource

import "github.com/use-crux/crux/packages/local/internal/projectindex"

func RequestProfile(
	profile *projectindex.SemanticSourceProfile,
	dependencyClosure []string,
) *projectindex.SemanticSourceProfile {
	if profile == nil {
		return nil
	}
	next := *profile
	next.DependencyClosure = UniqueFiles(dependencyClosure)
	profileFiles := map[string]bool{}
	for _, file := range next.Files {
		if file.File != "" {
			profileFiles[file.File] = true
		}
	}
	next.Complete = len(next.DependencyClosure) > 0
	for _, file := range next.DependencyClosure {
		if !profileFiles[file] {
			next.Complete = false
			break
		}
	}
	return &next
}

func RootFiles(
	files []string,
	profile *projectindex.SemanticSourceProfile,
) []string {
	if profile == nil {
		return UniqueFiles(files)
	}
	profilesByFile := map[string]projectindex.SemanticSourceProfileFile{}
	for _, file := range profile.Files {
		if file.File != "" {
			profilesByFile[file.File] = file
		}
	}
	out := []string{}
	for _, file := range UniqueFiles(files) {
		profileFile, ok := profilesByFile[file]
		if !ok || isSemanticRootProfile(profileFile) {
			out = append(out, file)
		}
	}
	return out
}

func isSemanticRootProfile(profile projectindex.SemanticSourceProfileFile) bool {
	if profile.Hints == nil {
		return true
	}
	hints := profile.Hints
	hasCurrentShapeHints := hints.CruxCallNames != nil || hints.HasZodObject || hints.NativeDirectCruxCandidate
	if !hasCurrentShapeHints {
		return true
	}
	return len(hints.CruxCallNames) > 0
}
