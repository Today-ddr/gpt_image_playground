import { describe, expect, it } from 'vitest'
import repository from './repository.ts?raw'
import header from '../components/Header.tsx?raw'
import help from '../components/HelpModal.tsx?raw'
import support from '../components/SupportPromptModal.tsx?raw'
import settings from '../components/SettingsModal.tsx?raw'
import versionCheck from '../hooks/useVersionCheck.ts?raw'

describe('GitHub repository links', () => {
  it('routes first-party GitHub surfaces to Today-ddr/gpt_image_playground', () => {
    expect(repository).toContain("export const GITHUB_REPOSITORY = 'Today-ddr/gpt_image_playground'")
    expect(header).toContain('href={GITHUB_REPOSITORY_URL}')
    expect(header).toContain('{GITHUB_REPOSITORY}')
    expect(help).toContain('href={GITHUB_REPOSITORY_URL}')
    expect(help).toContain('{GITHUB_REPOSITORY}')
    expect(support).toContain('href={GITHUB_ISSUES_URL}')
    expect(settings).toContain('href={GITHUB_REPOSITORY_URL}')
    expect(settings).toContain('{GITHUB_REPOSITORY}')
    expect(settings).toContain('href={GITHUB_ISSUES_URL}')
    expect(versionCheck).toContain('GITHUB_RELEASES_API_URL')
    expect(versionCheck).toContain('GITHUB_RELEASES_URL')
  })
})
