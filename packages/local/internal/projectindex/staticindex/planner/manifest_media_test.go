package planner

import "testing"

func TestDefaultManifestIncludesBoundedMediaStreamingCalls(t *testing.T) {
	for _, name := range []string{"streamImage", "streamSpeech"} {
		if !contains(defaultCallNames, name) {
			t.Fatalf("defaultCallNames missing %q", name)
		}
		if !contains(defaultCallInterestNames, name) {
			t.Fatalf("defaultCallInterestNames missing %q", name)
		}
	}
}
