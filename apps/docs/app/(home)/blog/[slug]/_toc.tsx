'use client'

// Sticky "On this page" rail with scroll-spy, per the Crux Blog design.

import { useEffect, useState } from 'react'

export interface TocItem {
  id: string
  title: string
}

export function PostToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null)

  useEffect(() => {
    const onScroll = () => {
      let current = items[0]?.id ?? null
      for (const item of items) {
        const el = document.getElementById(item.id)
        if (el && el.getBoundingClientRect().top < 120) current = item.id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [items])

  if (items.length === 0) return null

  return (
    <nav className="grid gap-0.5">
      <p className="mb-2.5 font-mono text-[10px] tracking-[0.2em] text-fd-muted-foreground">ON THIS PAGE</p>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={(e) => {
            e.preventDefault()
            const el = document.getElementById(item.id)
            if (el) {
              const y = el.getBoundingClientRect().top + window.scrollY - 76
              window.scrollTo({ top: y, behavior: 'smooth' })
              history.replaceState(null, '', `#${item.id}`)
            }
          }}
          className={`border-l-2 px-3 py-[5px] text-[13px] leading-normal transition-colors ${
            active === item.id
              ? 'border-crux text-fd-foreground'
              : 'border-fd-border text-fd-muted-foreground hover:text-fd-foreground'
          }`}
        >
          {item.title}
        </a>
      ))}
    </nav>
  )
}
