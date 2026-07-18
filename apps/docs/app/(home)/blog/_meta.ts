// Shared blog metadata: authors, type hues, and the serializable post shape
// passed from server pages into client components.

export const BLOG_AUTHORS: Record<string, { name: string; role: string; hue: number; initials: string }> = {
  henri: { name: "Henri van 't Sant", role: 'Creator', hue: 192, initials: 'HS' },
}

// Accent hue per post type — matches the Crux Blog design.
export const TYPE_HUE: Record<string, number> = {
  Release: 192,
  Engineering: 260,
  Essay: 25,
  Announcement: 140,
}

export interface PostMeta {
  slug: string
  url: string
  title: string
  description: string
  date: string // ISO
  dateLabel: string
  type: string
  tags: string[]
  authors: string[]
  readTime?: number
  featured: boolean
}

export function formatPostDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
