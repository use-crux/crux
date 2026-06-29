import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { buttonVariants } from 'fumadocs-ui/components/ui/button'
import { TrackedLink } from '@/components/tracked-link'
import { GitHubIcon, NpmIcon } from '@/components/brand-icons'

export const GITHUB_URL = 'https://github.com/use-crux/crux'
export const NPM_URL = 'https://www.npmjs.com/package/@use-crux/core'

export function baseOptions(): BaseLayoutProps {
  const iconClass = buttonVariants({ size: 'icon-sm', color: 'ghost' })
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-fd-foreground">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 22V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2 7l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="text-[15px] font-bold tracking-[-0.02em]">Crux</span>
        </div>
      ),
    },
    links: [
      {
        text: 'Why Crux',
        url: '/why',
      },
      {
        text: 'Observability',
        url: '/observability',
      },
      {
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
      },
      {
        text: 'Compare',
        url: '/compare',
      },
      {
        type: 'custom',
        secondary: true,
        children: (
          <TrackedLink
            href={GITHUB_URL}
            event="github_link_clicked"
            properties={{ location: 'navbar' }}
            aria-label="GitHub repository"
            target="_blank"
            rel="noreferrer noopener"
            className={iconClass}
          >
            <GitHubIcon />
          </TrackedLink>
        ),
      },
      {
        type: 'custom',
        secondary: true,
        children: (
          <TrackedLink
            href={NPM_URL}
            event="npm_link_clicked"
            properties={{ location: 'navbar' }}
            aria-label="npm package"
            target="_blank"
            rel="noreferrer noopener"
            className={iconClass}
          >
            <NpmIcon />
          </TrackedLink>
        ),
      },
    ],
  }
}
