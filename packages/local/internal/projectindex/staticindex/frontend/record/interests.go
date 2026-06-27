package record

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
)

func CallInterests(input []projectindex.StaticCallInterest) []frontend.CallInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]frontend.CallInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, frontend.CallInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  callbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func ConstructorInterests(input []projectindex.StaticConstructorInterest) []frontend.ConstructorInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]frontend.ConstructorInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, frontend.ConstructorInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  callbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func callbackInterests(input []projectindex.StaticCallbackInterest) []frontend.CallbackInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]frontend.CallbackInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, frontend.CallbackInterest{
			Property: interest.Property,
			MaxDepth: interest.MaxDepth,
		})
	}
	return interests
}
