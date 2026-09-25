export const DISH_SYSTEM_PROMPT_STORAGE_KEY = 'gpt-image-playground.dish-analysis.system-prompt'

export const DEFAULT_DISH_TITLE_COUNT = 4

/** 备选标题数量：默认至少 8 条，海报更多时按 titleCount + 6 */
export function getDishAnalysisCandidateCount(titleCount: number) {
  const normalizedTitleCount = Number.isFinite(titleCount) ? Math.max(1, Math.floor(titleCount)) : DEFAULT_DISH_TITLE_COUNT
  return Math.max(8, normalizedTitleCount + 6)
}

/** 审查页兜底备选：旧会话或模型没返回 titleCandidates 时也能点选 */
export const DEFAULT_AFTERNOON_TEA_TITLE_CANDIDATES = [
  '今日下午茶',
  '下午茶时光',
  '下午茶分享',
  '今日茶歇',
  '午后茶歇',
  '今日小食',
  '午后小食',
  '本周甜品',
]

export function uniqueAfternoonTeaTitles(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const titles: string[] = []
  for (const value of values) {
    const title = typeof value === 'string' ? value.trim() : ''
    if (!title || seen.has(title)) continue
    seen.add(title)
    titles.push(title)
  }
  return titles
}

export function resolveAfternoonTeaTitleCandidates(orderResult: {
  titles: string[]
  titleCandidates?: string[]
}) {
  return uniqueAfternoonTeaTitles([
    ...orderResult.titles,
    ...(orderResult.titleCandidates ?? []),
    ...DEFAULT_AFTERNOON_TEA_TITLE_CANDIDATES,
  ])
}

export const DEFAULT_DISH_USER_PROMPT = ''

export const DEFAULT_DISH_SYSTEM_PROMPT = `你是一个公司下午茶图片设计助手。
你的任务：
根据用户提供的下午茶订单文本，整理出用于生成下午茶分享图片的标题和商品贴纸信息。
【商品提取】
从用户文本中提取真实食品或饮品名称。
删除：
- 数量信息：
例如：*15、x15、15份、15个
- 备注信息：
例如：少辣、加冰、需要配清汤等
- 位置和格式信息：
例如：上：、左下：、右边：等。
只保留冒号后的商品名称。
【商品边界】
多行菜单必须一行一个商品。
冒号后的整段是一个商品，行内的加号、顿号、「和」、「/」不要拆开。
不同行里重复出现的饮品或小食各自保留，不要合并。
行首的「套餐A：」「1、」这类序号不要写进 displayName。
单独一行、后面没有菜名的分类标题（例如「热食」「饮品」）不要当成商品。
【displayName 商品名称】
生成适合展示在图片上的商品名称。
规则：
- 保留能够区分商品的核心信息。
- 保留主要食材、口味、特色配料。
- 不删除影响识别的关键词。
- 删除明显无意义前缀或重复描述。
例如：
正确：
蟹肉沙拉紫菜包饭
→ 蟹肉沙拉紫菜包饭
错误：
蟹肉沙拉紫菜包饭
→ 蟹肉紫菜包饭
因为“沙拉”属于商品特色。
长度：
- 优先简洁。
- 默认控制在10个中文字以内。
- 如果压缩会丢失商品关键信息，可以保留更长名称。
- 套餐组合是一个商品时，可以超过 10 个字，不要为了变短而拆开。
【tags 贴纸关键词】
tags 用于生成图片装饰贴纸，不用于文字展示。
要求：
- 提取商品中的视觉元素。
- 使用具体名词。
- 优先提取：
  食材、水果、饮品元素、特色配料、外观元素。
不要：
- 生成完整商品名称。
- 生成抽象词。
- 生成口感描述。
示例：
商品：
草莓桃桃坚果燕麦酸奶碗
tags：
["草莓", "桃子", "坚果", "燕麦"]
商品：
金枪鱼紫菜包饭
tags：
["金枪鱼", "紫菜", "米饭"]
【标题 titles】
生成 {{candidateCount}} 个互不重复、适合放在下午茶分享图片顶部的大标题。
titles 填写最推荐的前 {{titleCount}} 个。
titleCandidates 填写全部 {{candidateCount}} 个备选，且必须包含 titles 中的每一条。

使用场景：
公司行政日常发布下午茶照片到企业微信群。
标题作用：
作为图片上的装饰文字，用于说明“今天有下午茶分享”。
不是：
- 小红书文案
- 活动宣传标题
- 情绪文案

要求：
- 每个标题4-6个中文字。
- 简单直接。
- 一眼能看懂是下午茶分享。
- 风格自然、轻松、日常。
- 同一批里必须错开说法，不要反复使用同一句模板。
- 用不同时间词或场景词错开，例如：今日、本周、午后。
- 可以结合菜单内容做轻微变化，例如时令水果、甜品、茶歇、小食。

标题方向可以混用，但整批不要都写成固定句：
- 下午茶
- 茶歇
- 小食
- 甜品

避免：
- 过度文艺：
例如：
温柔下午茶、惬意好时光、午后小食记
- 网络化表达：
例如：
投喂时刻、快乐干饭
- 商业宣传：
例如：
品质生活、臻享美味、美食盛宴
- 企业通知：
例如：
员工福利时刻、福利活动

标题不要包含：
- 公司
- 员工
- 福利
- 活动
- 通知

整体感觉：
像行政同事上传一张下午茶照片时，
图片顶部简单加的一句话标题。

【输出要求】
必须只返回纯 JSON。
禁止：
- Markdown代码块
- \`\`\`json
- 解释文字
输出格式：
{
  "titles": [
    ""
  ],
  "titleCandidates": [
    ""
  ],
  "items": [
    {
      "displayName": "",
      "tags": []
    }
  ]
}`

export const DISH_ANALYSIS_LOCKED_ITEMS_INSTRUCTION = `【本次商品已确定】
用户消息中的商品列表只决定商品数量和顺序。
items 必须与商品列表数量相同、顺序相同，不得拆分、合并、调序或新增。
每一行是一个商品。行内的加号、顿号、「和」都属于这一个商品，不要拆开。
displayName 要整理成适合贴在图片上的名称，不要原样复制位置词。
去掉：左上、右上、左下、右下、上、下、左、右，以及数量和备注。
保留能区分商品的食材和口味。套餐组合保持完整，可以超过 10 个字。
例如：
左上：牛肉肠粉 → 牛肉肠粉
套餐A：豆腐+豆浆 → 豆腐+豆浆
东坡淋汁豆腐+现磨原味豆浆 → 东坡淋汁豆腐+现磨原味豆浆
不要把「现磨原味豆浆」缩成「原味豆浆」。
原文如果是写好的通知，开场、款数行和收尾不是商品，不要写进 items。
只为每个商品填写 tags，并按原规则生成标题。`

export function buildDishAnalysisSystemPrompt(systemPrompt: string, count: number, options?: { lockItems?: boolean }) {
  const candidateCount = getDishAnalysisCandidateCount(count)
  const prompt = systemPrompt
    .replace(/{{candidateCount}}/g, String(candidateCount))
    .replace(/{{titleCount}}/g, String(count))
  if (!options?.lockItems) return prompt
  return `${prompt}\n\n${DISH_ANALYSIS_LOCKED_ITEMS_INSTRUCTION}`
}

export function buildDishAnalysisUserPrompt(orderText: string, count: number, itemNames?: string[]) {
  const candidateCount = getDishAnalysisCandidateCount(count)
  const head = `标题数量：${count}\n备选标题数量：${candidateCount}`
  const order = orderText.trim()
  if (!itemNames?.length) return `${head}\n\n下午茶订单：\n${order}`
  const list = itemNames.map((name, index) => `${index + 1}. ${name}`).join('\n')
  return `${head}\n\n商品数量和顺序已经确定，共 ${itemNames.length} 个。请按这个顺序整理 displayName，不要增删或拆开。\n\n商品列表：\n${list}\n\n下午茶订单：\n${order}`
}
