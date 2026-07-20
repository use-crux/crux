package main

import "github.com/use-crux/crux/packages/local/internal/cli"

// factoryInput defers resolving process input until Cobra reads it. This keeps
// root construction testable and lets flags be parsed before production IO is
// initialized.
type factoryInput struct {
	factory *cli.Factory
}

func (input factoryInput) Read(data []byte) (int, error) {
	return input.factory.Streams().In.Read(data)
}

// factoryOutput defers resolving result or diagnostic output until Cobra
// writes it, while still allowing callers to replace Cobra's streams later.
type factoryOutput struct {
	factory    *cli.Factory
	diagnostic bool
}

func (output factoryOutput) Write(data []byte) (int, error) {
	if output.diagnostic {
		return output.factory.Streams().Err.Write(data)
	}
	return output.factory.Streams().Out.Write(data)
}
