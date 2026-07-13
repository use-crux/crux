type MediaTokenInput = Readonly<{ model: string }>

// https://platform.openai.com/docs/guides/images-vision#calculating-costs
// Verified 2026-07-11: current token rules vary by model/detail and cannot be
// reproduced from the Asset-only facts available at this private boundary.
export function estimateOpenAIMediaTokens(_input: MediaTokenInput): undefined {
  return undefined
}
