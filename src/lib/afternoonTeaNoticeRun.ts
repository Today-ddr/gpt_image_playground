import type { ApiProfile } from '../types'
import { segmentAfternoonTeaMenu } from './afternoonTeaMenu'
import {
  buildAfternoonTeaNoticeUserPrompt,
  parseAfternoonTeaNoticeResult,
  validateAfternoonTeaNoticeInput,
  type AfternoonTeaNotice,
} from './afternoonTeaNotice'
import { generateAfternoonTeaNotice } from './afternoonTeaNoticeApi'

export type AfternoonTeaNoticeRunResult = {
  notices: AfternoonTeaNotice[]
  sourceChannel: string
  sourceModel: string
  elapsed: number
}

type NoticeGenerator = typeof generateAfternoonTeaNotice

/** 同一会话的通知请求互相替换，不碰餐品解析自己的取消开关 */
export class AfternoonTeaNoticeRunCoordinator {
  private controllers = new Map<string, AbortController>()

  begin(conversationId: string) {
    this.controllers.get(conversationId)?.abort()
    const controller = new AbortController()
    this.controllers.set(conversationId, controller)
    return controller
  }

  isCurrent(conversationId: string, controller: AbortController) {
    return this.controllers.get(conversationId) === controller
  }

  finish(conversationId: string, controller: AbortController) {
    if (this.controllers.get(conversationId) === controller) this.controllers.delete(conversationId)
  }

  dispose() {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
}

export async function runAfternoonTeaNotice(input: {
  menuText: string
  supplement: string
  systemPrompt: string
  profile: ApiProfile
  signal?: AbortSignal
  generate?: NoticeGenerator
}): Promise<AfternoonTeaNoticeRunResult> {
  validateAfternoonTeaNoticeInput(input.menuText)
  const startedAt = Date.now()
  const segments = segmentAfternoonTeaMenu(input.menuText)
  const generate = input.generate ?? generateAfternoonTeaNotice
  const raw = await generate({
    profile: input.profile,
    userPrompt: buildAfternoonTeaNoticeUserPrompt(input.menuText, input.supplement, segments),
    systemPrompt: input.systemPrompt,
    signal: input.signal,
  })
  return {
    notices: parseAfternoonTeaNoticeResult(raw, segments),
    sourceChannel: input.profile.name.trim(),
    sourceModel: input.profile.understandingModel?.trim() ?? '',
    elapsed: Math.max(0, Date.now() - startedAt),
  }
}
