import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { SkillActivationSession } from '@use-crux/core/skill'
import type { PromptMessage } from './message-shapes'
import { observeSkillInstructionInjected } from './observability'

function appendText(content: string | import('./message-shapes').MessagePart[], text: string): void {
  if (typeof content === 'string') return
  content.push({ type: 'text', text })
}

/**
 * Inject newly loaded skill instructions into the next AI SDK model step.
 *
 * LoadSkill tools activate skill state during a tool round. Agent frameworks
 * then call the model again with the previous messages; this helper appends
 * newly activated skill instructions to the system message before that call.
 */
export function injectNewlyActivatedSkills(
  params: LanguageModelV3CallOptions,
  session?: SkillActivationSession,
): void {
  if (!session) return

  const newSkills = session.newlyActivated()
  if (newSkills.length === 0) return

  const prompt = params.prompt as unknown as PromptMessage[] | undefined
  if (!Array.isArray(prompt)) return

  for (const message of prompt) {
    if (message.role !== 'system') continue
    const skillInstructions = newSkills.map((skill) => `\n\n## Skill: ${skill.id}\n\n${skill.instructions}`).join('')

    if (typeof message.content === 'string') {
      message.content += skillInstructions
    } else if (Array.isArray(message.content)) {
      appendText(message.content, skillInstructions)
    }
    break
  }

  session.markInjected(newSkills.map((entry) => entry.id))
  for (const skill of newSkills) {
    observeSkillInstructionInjected(skill.id)
  }
}
