package staticplan

import "testing"

func TestProjectNativeStaticSignalMatcherKeepsSpacedCallAndConstructorSupport(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	for _, source := range []string{
		"export const writer = prompt ({ id: 'writer' })",
		"export const worker = new Agent ({ name: 'worker' })",
	} {
		if !matcher.HasCruxInterest(source) {
			t.Fatalf("matcher did not detect Crux interest in %q", source)
		}
	}
}
