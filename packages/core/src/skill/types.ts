/**
 * Skill types for @use-crux/core/skill
 *
 * A Skill is a Markdown-based instruction set that an LLM can load on-demand.
 * Skills are compatible with the skills.sh community format (SKILL.md with YAML frontmatter).
 */

/** Metadata extracted from SKILL.md YAML frontmatter. */
export interface SkillMeta {
  readonly name: string
  readonly description: string
  readonly version?: string
  readonly license?: string
  readonly tags?: readonly string[]
}

/** A reference file bundled with a skill (from references/ subdirectory). */
export interface SkillReference {
  readonly name: string
  readonly content: string
}

/** The Skill type — an opaque instruction set compatible with ContextEntry. */
export interface Skill {
  readonly _tag: 'Skill'
  readonly id: string
  readonly description: string
  readonly instructions: string
  readonly references: readonly SkillReference[]
  readonly meta: SkillMeta
  /** Returns the raw instruction text. Exits the skill system — no LoadSkill/LoadReference tools. */
  dump(): string
}

/** Config for skill.inline(). */
export interface InlineSkillConfig {
  readonly id: string
  readonly description: string
  readonly instructions: string
  readonly references?: Record<string, string>
}

/** A skill whose content is not yet loaded (from registry). */
export interface LazySkill extends Skill {
  /** @internal Whether content has been fetched. */
  readonly _loaded: boolean
  /** @internal Fetch and populate content. */
  _load(): Promise<void>
}

/** Error thrown when skill loading fails. */
export class SkillLoadError extends Error {
  readonly _tag = 'SkillLoadError' as const
  declare readonly cause?: unknown

  constructor(
    public readonly skillId: string,
    public readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to load skill "${skillId}": ${reason}`)
    this.name = 'SkillLoadError'
    if (options?.cause) {
      this.cause = options.cause
    }
  }
}
