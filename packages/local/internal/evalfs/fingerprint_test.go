package evalfs

import "testing"

func TestFingerprintJSONValueMatchesTypeScriptStringOrderingAndEscaping(t *testing.T) {
	got, err := fingerprintJSONValue(map[string]any{
		"\uE000":     float64(1),
		"\U0001F600": float64(2),
		"a<b":        float64(3),
	})
	if err != nil {
		t.Fatal(err)
	}
	const want = "e4a87f243b99b30a8a43e91df873716948e92bbd6e851db3d287093f90d82b9b"
	if got != want {
		t.Fatalf("fingerprint = %s, want TypeScript canonical fingerprint %s", got, want)
	}
}
