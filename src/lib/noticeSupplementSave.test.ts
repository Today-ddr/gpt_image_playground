import { describe, expect, it } from 'vitest'
import { createNoticeSupplementSaver } from './noticeSupplementSave'

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number, run: () => void }>()

  return {
    schedule(callback: () => void, delayMs: number) {
      const id = nextId
      nextId += 1
      timers.set(id, { at: now + delayMs, run: callback })
      return id
    },
    cancel(id: number) {
      timers.delete(id)
    },
    advance(ms: number) {
      now += ms
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue
        timers.delete(id)
        timer.run()
      }
    },
  }
}

describe('createNoticeSupplementSaver', () => {
  it('writes the latest text once when flushed before the delay', () => {
    const saved: Array<{ conversationId: string, value: string }> = []
    const clock = fakeClock()
    const saver = createNoticeSupplementSaver({
      save: (conversationId, value) => saved.push({ conversationId, value }),
      schedule: clock.schedule,
      cancel: clock.cancel,
    })

    saver.schedule('conversation-a', '汉堡')
    saver.schedule('conversation-a', '汉堡包')
    saver.flush()
    saver.flush()

    expect(saved).toEqual([{ conversationId: 'conversation-a', value: '汉堡包' }])
  })

  it('does not write again after the timer already saved', () => {
    const saved: string[] = []
    const clock = fakeClock()
    const saver = createNoticeSupplementSaver({
      save: (_conversationId, value) => saved.push(value),
      schedule: clock.schedule,
      cancel: clock.cancel,
    })

    saver.schedule('conversation-a', '奶茶')
    clock.advance(400)
    saver.flush()

    expect(saved).toEqual(['奶茶'])
  })

  it('writes the previous conversation immediately when the draft moves to another one', () => {
    const saved: Array<{ conversationId: string, value: string }> = []
    const clock = fakeClock()
    const saver = createNoticeSupplementSaver({
      save: (conversationId, value) => saved.push({ conversationId, value }),
      schedule: clock.schedule,
      cancel: clock.cancel,
    })

    saver.schedule('conversation-a', '汉堡包')
    saver.schedule('conversation-b', '霸王茶姬')
    saver.flush()

    expect(saved).toEqual([
      { conversationId: 'conversation-a', value: '汉堡包' },
      { conversationId: 'conversation-b', value: '霸王茶姬' },
    ])
  })
})
