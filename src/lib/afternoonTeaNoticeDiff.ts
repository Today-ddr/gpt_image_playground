export type AfternoonTeaNoticeDiffPart = '开场' | '清单' | '收尾'

export type AfternoonTeaNoticeDiffLine = {
  text: string
  changed: boolean
}

export type AfternoonTeaNoticeDiff = {
  parts: AfternoonTeaNoticeDiffPart[]
  lines: AfternoonTeaNoticeDiffLine[]
}

type NoticeSections = Record<AfternoonTeaNoticeDiffPart, string>

const DIFF_PARTS: AfternoonTeaNoticeDiffPart[] = ['开场', '清单', '收尾']

function splitAfternoonTeaNoticeSections(text: string): NoticeSections {
  const blocks = text.split(/\n\n/)
  const filled = blocks.filter((block) => block.trim())
  if (filled.length <= 1) {
    return { 开场: filled[0] ?? '', 清单: '', 收尾: '' }
  }
  return {
    开场: filled[0],
    清单: filled.slice(1, -1).join('\n\n'),
    收尾: filled[filled.length - 1],
  }
}

function sectionAt(blockCount: number, order: number): AfternoonTeaNoticeDiffPart {
  if (blockCount <= 1 || order === 0) return '开场'
  if (order === blockCount - 1) return '收尾'
  return '清单'
}

/** 后几张卡相对第一张：只标出开场、清单、收尾里真正不同的句子 */
export function diffAfternoonTeaNotice(baseline: string, current: string): AfternoonTeaNoticeDiff {
  const base = splitAfternoonTeaNoticeSections(baseline)
  const next = splitAfternoonTeaNoticeSections(current)
  const changedParts = new Set(DIFF_PARTS.filter((part) => base[part] !== next[part]))
  const blocks = current.split(/\n\n/)
  const filledIndexes = blocks.flatMap((block, index) => block.trim() ? [index] : [])
  const partByBlock = new Map<number, AfternoonTeaNoticeDiffPart>()
  filledIndexes.forEach((blockIndex, order) => {
    partByBlock.set(blockIndex, sectionAt(filledIndexes.length, order))
  })

  const lines: AfternoonTeaNoticeDiffLine[] = []
  blocks.forEach((block, index) => {
    if (index > 0) lines.push({ text: '', changed: false })
    const part = partByBlock.get(index)
    const changed = part ? changedParts.has(part) : false
    for (const line of block.split('\n')) {
      lines.push({ text: line, changed: changed && Boolean(line.trim()) })
    }
  })

  return {
    parts: DIFF_PARTS.filter((part) => changedParts.has(part)),
    lines,
  }
}
