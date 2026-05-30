/**
 * Skill catalog — generates the system prompt section listing available skills.
 */

import type { Skill } from './types'

/**
 * Generate the catalog system prompt text for a set of skills.
 * This is injected into the system prompt when >=1 skill is in the use array.
 */
export function generateCatalog(skills: readonly Skill[]): string {
  if (skills.length === 0) return ''

  const skillEntries = skills
    .map((s) => {
      const refs = s.references.length > 0 ? ` (references: ${s.references.map((r) => r.name).join(', ')})` : ''
      return `- **${s.id}**: ${s.description}${refs}`
    })
    .join('\n')

  return `## Skills

You have access to skills — loadable instruction sets that give you specialized knowledge and procedures for specific tasks. Skills are loaded on-demand to keep your context focused.

Review the available skills below. When a user's request matches a skill's expertise, load it BEFORE beginning work. You may load multiple skills if the task spans several domains.

### Available Skills
${skillEntries}

### How to Use
- \`LoadSkill(name)\` — Load a skill's full instructions into your context. Always load relevant skills before starting work.
- \`LoadReference(skillName, referenceName)\` — Load supporting reference material for a loaded skill.

Load skills proactively at the start of a task. Do not wait to be asked.`
}
