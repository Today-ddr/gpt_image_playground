export type NoticeSupplementSave = {
  conversationId: string
  value: string
}

const DEFAULT_DELAY_MS = 400

/**
 * 补充信息先记在内存里，停手后再写入会话。
 * 换会话或页面被关掉时立刻写完，避免最后一次输入丢掉。
 */
export function createNoticeSupplementSaver(options: {
  save: (conversationId: string, value: string) => void
  schedule?: (callback: () => void, delayMs: number) => number
  cancel?: (id: number) => void
  delayMs?: number
}) {
  let timerId: number | null = null
  let pending: NoticeSupplementSave | null = null
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay) as unknown as number)
  const cancel = options.cancel ?? ((id) => window.clearTimeout(id))

  const commit = () => {
    const current = pending
    pending = null
    if (current) options.save(current.conversationId, current.value)
  }

  return {
    schedule(conversationId: string, value: string) {
      if (pending && pending.conversationId !== conversationId) this.flush()
      pending = { conversationId, value }
      if (timerId != null) cancel(timerId)
      const id = schedule(() => {
        if (timerId !== id) return
        timerId = null
        commit()
      }, delayMs)
      timerId = id
    },
    flush() {
      if (timerId != null) cancel(timerId)
      timerId = null
      commit()
    },
  }
}
