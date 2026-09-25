import { getAfternoonTeaPosterItemTaskIds } from './afternoonTeaConversations'
import type { AfternoonTeaPosterBatchItem, TaskRecord } from '../types'

const READY_TITLE = /^(?:\d+ 张海报好了|海报生成结束) · /

export function posterReadyLabel(doneCount: number) {
  return doneCount > 0 ? `${doneCount} 张海报好了` : '海报生成结束'
}

export function stripPosterReadyTitle(title: string) {
  return title.replace(READY_TITLE, '')
}

export function countReadyPosterImages(
  items: AfternoonTeaPosterBatchItem[],
  tasks: Pick<TaskRecord, 'id' | 'status' | 'outputImages'>[],
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const imageIds = new Set<string>()
  for (const item of items) {
    for (const taskId of getAfternoonTeaPosterItemTaskIds(item)) {
      const task = taskById.get(taskId)
      if (task?.status !== 'done') continue
      for (const imageId of task.outputImages) imageIds.add(imageId)
    }
  }
  return imageIds.size
}

/** 第一次看到的已完成批次不算新完成，避免刷新旧会话就改标题 */
export function shouldStartPosterReadyReminder(input: {
  previousKey: string | null | undefined
  nextKey: string | null
  hidden: boolean
}) {
  if (input.previousKey === undefined) return { knownKey: input.nextKey, start: false }
  if (input.nextKey === input.previousKey) return { knownKey: input.previousKey, start: false }
  return { knownKey: input.nextKey, start: Boolean(input.nextKey) && input.hidden }
}

/** 会话还没从本地加载完时，不能把「还没有批次」记成已经看过的基线。 */
export function observePosterReadyFinish(input: {
  loaded: boolean
  knownKey: string | null | undefined
  nextKey: string | null
  hidden: boolean
}) {
  if (!input.loaded) return { knownKey: input.knownKey, start: false }
  return shouldStartPosterReadyReminder({
    previousKey: input.knownKey,
    nextKey: input.nextKey,
    hidden: input.hidden,
  })
}

/** 切走标签时，只有这一页打开之后新完成的批次才闪标题。 */
export function shouldBlinkPosterReadyOnHide(baselineKey: string | null | undefined, finishKey: string | null) {
  if (baselineKey === undefined) return false
  return Boolean(finishKey) && finishKey !== baselineKey
}

export class PosterReadyTitleReminder {
  private timer: number | null = null
  private baseTitle = ''
  private label = '海报好了'
  private showReady = false

  constructor(private deps: {
    getTitle: () => string
    setTitle: (title: string) => void
    setInterval?: typeof window.setInterval
    clearInterval?: typeof window.clearInterval
  }) {}

  get reminding() {
    return this.timer != null
  }

  start(label: string) {
    this.stop()
    this.baseTitle = stripPosterReadyTitle(this.deps.getTitle())
    this.label = label
    this.showReady = true
    this.deps.setTitle(this.readyTitle())
    const setInterval = this.deps.setInterval ?? window.setInterval.bind(window)
    this.timer = setInterval(() => {
      this.showReady = !this.showReady
      this.deps.setTitle(this.showReady ? this.readyTitle() : this.baseTitle)
    }, 1_000)
  }

  /** 后面又出了图，只改张数，不打断正在交替的提醒 */
  update(label: string) {
    if (this.timer == null) {
      this.start(label)
      return
    }
    if (this.label === label) return
    this.label = label
    if (this.showReady) this.deps.setTitle(this.readyTitle())
  }

  private readyTitle() {
    return `${this.label} · ${this.baseTitle}`
  }

  stop() {
    if (this.timer != null) {
      const clearInterval = this.deps.clearInterval ?? window.clearInterval.bind(window)
      clearInterval(this.timer)
    }
    this.timer = null
    this.showReady = false
    if (this.baseTitle) this.deps.setTitle(this.baseTitle)
  }
}
