package sourcehash

import "testing"

func TestSumMatchesIndexSourceHashRepresentation(t *testing.T) {
	t.Parallel()

	source := []byte("const café = \"😀\";\r\n")
	const want = "134eed8d9f44810555bfbdf5ec1ab3a56e20cd21b777f50ddba2f0dfeb781e07"
	if got := Sum(source); got != want {
		t.Fatalf("source hash = %q, want %q", got, want)
	}
}
