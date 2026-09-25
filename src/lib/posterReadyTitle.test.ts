import { describe, expect, it } from 'vitest'
import {
  PosterReadyTitleReminder,
  countReadyPosterImages,
  posterReadyLabel,
  observePosterReadyFinish,
  shouldBlinkPosterReadyOnHide,
  shouldStartPosterReadyReminder,
} from './posterReadyTitle'

describe('poster ready title reminder', () => {
  it('does not treat a batch that was already finished on load as a new completion', () => {
    expect(shouldStartPosterReadyReminder({
      previousKey: undefined,
      nextKey: 'conversation:1:2',
      hidden: true,
    })).toEqual({ knownKey: 'conversation:1:2', start: false })
  })

  it('does not record an empty baseline before conversations finish loading', () => {
    expect(observePosterReadyFinish({
      loaded: false,
      knownKey: undefined,
      nextKey: null,
      hidden: true,
    })).toEqual({ knownKey: undefined, start: false })

    const loaded = observePosterReadyFinish({
      loaded: true,
      knownKey: undefined,
      nextKey: 'conversation:1:2',
      hidden: true,
    })
    expect(loaded).toEqual({ knownKey: 'conversation:1:2', start: false })
    expect(shouldBlinkPosterReadyOnHide('conversation:1:2', 'conversation:1:2')).toBe(false)
    expect(shouldBlinkPosterReadyOnHide(undefined, 'conversation:1:2')).toBe(false)
    expect(shouldBlinkPosterReadyOnHide(null, 'conversation:1:2')).toBe(true)
  })

  it('starts only when a new batch finishes while the tab is hidden', () => {
    expect(shouldStartPosterReadyReminder({
      previousKey: null,
      nextKey: 'conversation:1:2',
      hidden: true,
    })).toEqual({ knownKey: 'conversation:1:2', start: true })
    expect(shouldStartPosterReadyReminder({
      previousKey: null,
      nextKey: 'conversation:1:2',
      hidden: false,
    }).start).toBe(false)
  })

  it('keeps alternating the title until stopped, then restores the original', () => {
    let title = 'GPT Image Playground'
    const timers = new Map<number, () => void>()
    let nextId = 1
    const reminder = new PosterReadyTitleReminder({
      getTitle: () => title,
      setTitle: (value) => { title = value },
      setInterval: ((handler: () => void) => {
        const id = nextId
        nextId += 1
        timers.set(id, handler)
        return id
      }) as typeof window.setInterval,
      clearInterval: ((id: number) => { timers.delete(id) }) as typeof window.clearInterval,
    })

    reminder.start(posterReadyLabel(3))
    expect(title).toBe('3 张海报好了 · GPT Image Playground')
    timers.get(1)?.()
    expect(title).toBe('GPT Image Playground')
    timers.get(1)?.()
    expect(title).toBe('3 张海报好了 · GPT Image Playground')
    reminder.stop()
    expect(title).toBe('GPT Image Playground')
    expect(reminder.reminding).toBe(false)
    expect(timers.size).toBe(0)
  })

  it('updates the count when more images arrive without restarting the blink', () => {
    let title = 'GPT Image Playground'
    const reminder = new PosterReadyTitleReminder({
      getTitle: () => title,
      setTitle: (value) => { title = value },
      setInterval: (() => 1) as typeof window.setInterval,
      clearInterval: (() => {}) as typeof window.clearInterval,
    })

    reminder.start(posterReadyLabel(2))
    reminder.update(posterReadyLabel(5))
    expect(title).toBe('5 张海报好了 · GPT Image Playground')
    expect(reminder.reminding).toBe(true)
  })

  it('counts every finished image, including several from one poster', () => {
    expect(countReadyPosterImages([
      { id: 'a', title: '一', prompt: 'p', taskId: 'done' },
      { id: 'b', title: '二', prompt: 'p', taskId: 'running' },
      { id: 'c', title: '三', prompt: 'p', setupError: '失败' },
    ], [
      { id: 'done', status: 'done', outputImages: ['image-a', 'image-b'] },
      { id: 'running', status: 'running', outputImages: [] },
    ])).toBe(2)
    expect(posterReadyLabel(0)).toBe('海报生成结束')
  })
})
