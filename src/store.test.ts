import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'
import { DEFAULT_DISH_SYSTEM_PROMPT, DEFAULT_DISH_TITLE_COUNT } from './lib/dishAnalysisPrompts'
import type { AfternoonTeaConversation, AgentConversation, ApiProfile, AppSettings, ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
import { hasActiveDataOperations } from './lib/dataOperations'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  const agentConversations = new Map<string, AgentConversation>()
  const afternoonTeaConversations = new Map<string, AfternoonTeaConversation>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    putTask: vi.fn(async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    }),
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAgentConversations: async () => [...agentConversations.values()],
    putAgentConversation: async (conversation: AgentConversation) => {
      agentConversations.set(conversation.id, conversation)
      return conversation.id
    },
    deleteAgentConversation: async (id: string) => {
      agentConversations.delete(id)
    },
    clearAgentConversations: async () => {
      agentConversations.clear()
    },
    replaceAgentConversations: async (conversations: AgentConversation[]) => {
      agentConversations.clear()
      for (const conversation of conversations) agentConversations.set(conversation.id, conversation)
    },
    getAllAfternoonTeaConversations: async () => [...afternoonTeaConversations.values()],
    putAfternoonTeaConversation: async (conversation: AfternoonTeaConversation) => {
      afternoonTeaConversations.set(conversation.id, conversation)
      return conversation.id
    },
    clearAfternoonTeaConversations: async () => {
      afternoonTeaConversations.clear()
    },
    replaceAfternoonTeaConversations: vi.fn(async (conversations: AfternoonTeaConversation[]) => {
      afternoonTeaConversations.clear()
      for (const conversation of conversations) afternoonTeaConversations.set(conversation.id, conversation)
    }),
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: vi.fn(async (id: string, shouldDelete?: () => boolean) => {
      if (shouldDelete && !shouldDelete()) return false
      images.delete(id)
      thumbnails.delete(id)
      return true
    }),
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: vi.fn(async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    }),
    storeImageWithSize: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      const size = dataUrl.match(/(\d+)x(\d+)/)
      const width = size ? Number(size[1]) : undefined
      const height = size ? Number(size[2]) : undefined
      images.set(id, { id, dataUrl, source, createdAt: Date.now(), width, height })
      return { id, width, height }
    },
  }
})
vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/imageJobApi', () => ({
  getImageJobExecutionPreference: vi.fn(async () => ({ executionMode: 'browser', requiresConfirmation: false })),
  getImageJob: vi.fn(),
  submitImageJob: vi.fn(),
}))
vi.mock('./lib/browserNotification', () => ({
  showBrowserNotification: vi.fn(() => true),
}))
vi.mock('./lib/falAiImageApi', () => ({
  getFalErrorMessage: vi.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
  getFalQueuedImageResult: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/transparentImage', () => ({
  GREEN_KEY_COLOR: '#00FF00',
  MAGENTA_KEY_COLOR: '#FF00FF',
  createTransparentOutputMeta: vi.fn((prompt: string) => ({
    transparentOutput: true,
    effectivePrompt: `transparent:${prompt}`,
  })),
  getTransparentRequestParams: vi.fn((params: typeof DEFAULT_PARAMS) => ({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
  })),
  removeKeyedBackgroundFromDataUrl: vi.fn(async (dataUrl: string) => `transparent:${dataUrl}`),
}))
vi.mock('./lib/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { images?: Array<{ id?: string; prompt?: string }> }
      return parsed.images?.map((item, index) => ({
        id: item.id || `image_${index + 1}`,
        prompt: item.prompt || '',
      })) ?? null
    } catch {
      return null
    }
  }),
}))
import { clearAfternoonTeaConversations, clearAgentConversations, clearImages, clearTasks, deleteImage, getAllAfternoonTeaConversations, getAllAgentConversations, getAllTasks, getImage, putAfternoonTeaConversation, putAgentConversation, putImage, putTask as putDbTask, replaceAfternoonTeaConversations, storeImage } from './lib/db'
import { callImageApi } from './lib/api'
import { getImageJob, getImageJobExecutionPreference, submitImageJob } from './lib/imageJobApi'
import { showBrowserNotification } from './lib/browserNotification'
import { callAgentResponsesApi, callBatchImageSingle } from './lib/agentApi'
import { getFalQueuedImageResult } from './lib/falAiImageApi'
import { removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { cleanStaleAgentInputDrafts, clearData, clearFailedTasks, deleteAgentRoundFromConversation, deleteFavoriteCollection, deleteImageIfUnreferenced, editOutputs, exportData, getActiveAgentRounds, getAgentConversationTaskIds, getAgentRoundTaskIds, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, markInterruptedOpenAIRunningTasks, mergePersistedState, migratePersistedState, regenerateAgentAssistantMessage, remapAgentRoundMentionsForPathChange, removeMultipleTasks, removeTask, retryTask, reuseConfig, stopAgentResponse, submitAfternoonTeaPosterTask, submitAgentMessage, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, updateTaskInStore, useStore } from './store'
import { readExportZip } from './lib/exportZip'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function afternoonTeaConversation(overrides: Partial<AfternoonTeaConversation> = {}): AfternoonTeaConversation {
  return {
    id: 'afternoon-tea-a',
    title: '新下午茶会话',
    createdAt: 1,
    updatedAt: 1,
    sourceImageId: null,
    sourceImageName: '',
    orderText: '',
    titleCount: DEFAULT_DISH_TITLE_COUNT,
    itemTitleRegions: [],
    systemPrompt: '系统提示词',
    analysisSystemPromptSnapshot: null,
    analysisUserPromptSnapshot: null,
    analysisElapsed: null,
    orderResult: null,
    posterItems: [],
    batchStartedAt: null,
    batchFinishedAt: null,
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function importFile(data: ExportData, files: Record<string, Uint8Array> = {}): File {
  const zipped = zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { name: 'backup.zip', size: zipped.byteLength, arrayBuffer: async () => buffer.slice(0) } as File
}

type SubmitAfternoonTeaPosterTaskOptions = Parameters<typeof submitAfternoonTeaPosterTask>[0]

function afternoonTeaSettings(profile: ApiProfile): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: [profile],
    activeProfileId: profile.id,
  }
}

function afternoonTeaOptions(settingsSnapshot: AppSettings, overrides: Partial<SubmitAfternoonTeaPosterTaskOptions> = {}): SubmitAfternoonTeaPosterTaskOptions {
  return {
    settingsSnapshot,
    paramsSnapshot: { ...DEFAULT_PARAMS },
    inputImage: imageA,
    batchId: 'afternoon-tea-batch-a',
    title: '夏日下午茶',
    prompt: '生成夏日下午茶海报',
    onTaskCreated: vi.fn(),
    ...overrides,
  }
}

describe('afternoon tea batch operation lease', () => {
  beforeEach(() => {
    useStore.setState({ afternoonTeaBatchOperationId: null })
  })

  it('admits only one operation synchronously', () => {
    expect(useStore.getState().afternoonTeaBatchOperationId).toBeNull()
    expect(useStore.getState().tryBeginAfternoonTeaBatchOperation('operation-a')).toBe(true)
    expect(useStore.getState().tryBeginAfternoonTeaBatchOperation('operation-b')).toBe(false)
    expect(useStore.getState().afternoonTeaBatchOperationId).toBe('operation-a')
  })

  it('only lets the current owner release the lease', () => {
    expect(useStore.getState().tryBeginAfternoonTeaBatchOperation('operation-a')).toBe(true)
    useStore.getState().finishAfternoonTeaBatchOperation('operation-a')
    expect(useStore.getState().tryBeginAfternoonTeaBatchOperation('operation-b')).toBe(true)

    useStore.getState().finishAfternoonTeaBatchOperation('operation-a')

    expect(useStore.getState().afternoonTeaBatchOperationId).toBe('operation-b')
    useStore.getState().finishAfternoonTeaBatchOperation('operation-b')
    expect(useStore.getState().afternoonTeaBatchOperationId).toBeNull()
  })

  it('never persists or restores the in-memory lease', () => {
    useStore.setState({ afternoonTeaBatchOperationId: 'operation-live' })

    const persisted = getPersistedState(useStore.getState())
    const restored = mergePersistedState(
      { afternoonTeaBatchOperationId: 'operation-injected' },
      useStore.getState(),
    )

    expect(persisted).not.toHaveProperty('afternoonTeaBatchOperationId')
    expect(restored.afternoonTeaBatchOperationId).toBeNull()
  })
})

describe('afternoonTea conversation store', () => {
  beforeEach(async () => {
    await clearAfternoonTeaConversations()
    useStore.setState({
      afternoonTeaConversations: [],
      afternoonTeaConversationsLoaded: false,
      activeAfternoonTeaConversationId: null,
      afternoonTeaEditingConversationId: null,
      defaultAfternoonTeaTitleCount: DEFAULT_DISH_TITLE_COUNT,
    })
    await initStore()
    vi.mocked(replaceAfternoonTeaConversations).mockClear()
  })

  it('creates and reuses the latest empty conversation with shared defaults', () => {
    const id = useStore.getState().createAfternoonTeaConversation()
    const created = useStore.getState().afternoonTeaConversations[0]
    const reusedId = useStore.getState().createAfternoonTeaConversation()

    expect(reusedId).toBe(id)
    expect(useStore.getState().afternoonTeaConversations).toHaveLength(1)
    expect(created).toMatchObject({
      id,
      title: '新下午茶会话',
      sourceImageId: null,
      sourceImageName: '',
      orderText: '',
      titleCount: DEFAULT_DISH_TITLE_COUNT,
      itemTitleRegions: [],
      systemPrompt: DEFAULT_DISH_SYSTEM_PROMPT,
      analysisSystemPromptSnapshot: null,
      analysisUserPromptSnapshot: null,
      orderResult: null,
      posterItems: [],
      batchStartedAt: null,
      batchFinishedAt: null,
    })
    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(id)
  })

  it('force-creates a conversation without reusing another empty conversation', () => {
    const first = useStore.getState().createAfternoonTeaConversation()
    const second = useStore.getState().createAfternoonTeaConversation({ force: true })

    expect(second).not.toBe(first)
    expect(useStore.getState().afternoonTeaConversations.map((conversation) => conversation.id)).toEqual([first, second])
    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(second)
  })

  it('stores the title count preference and force-creates with it', () => {
    expect(useStore.getState().defaultAfternoonTeaTitleCount).toBe(4)

    useStore.getState().setDefaultAfternoonTeaTitleCount(7)
    const id = useStore.getState().createAfternoonTeaConversation({ force: true })

    expect(useStore.getState().defaultAfternoonTeaTitleCount).toBe(7)
    expect(useStore.getState().afternoonTeaConversations.find((item) => item.id === id)?.titleCount).toBe(7)
  })

  it('reuses an empty conversation and synchronizes the latest title count preference', () => {
    const first = useStore.getState().createAfternoonTeaConversation()

    useStore.getState().setDefaultAfternoonTeaTitleCount(7)
    const reused = useStore.getState().createAfternoonTeaConversation()

    expect(reused).toBe(first)
    expect(useStore.getState().afternoonTeaConversations).toHaveLength(1)
    expect(useStore.getState().afternoonTeaConversations[0].titleCount).toBe(7)
  })

  it('resets an imported empty conversation item regions when reusing it as new', () => {
    const first = useStore.getState().createAfternoonTeaConversation()
    useStore.getState().updateAfternoonTeaConversation(first, {
      itemTitleRegions: [{ x: 0.1, y: 0.6, width: 0.3, height: 0.2 }],
    })

    const reused = useStore.getState().createAfternoonTeaConversation()

    expect(reused).toBe(first)
    expect(useStore.getState().afternoonTeaConversations[0].itemTitleRegions)
      .toEqual([])
  })

  it.each([
    [0, 1],
    [11, 10],
    [7.9, 7],
    ['7', 4],
    [Number.NaN, 4],
    [Number.POSITIVE_INFINITY, 4],
  ])('normalizes a persisted title count preference from %s to %s', (persistedValue, expected) => {
    const restored = mergePersistedState({
      defaultAfternoonTeaTitleCount: persistedValue,
    }, useStore.getState())

    expect(restored.defaultAfternoonTeaTitleCount).toBe(expected)
  })

  it('restores the persisted title count preference before force-creating a conversation', () => {
    const originalState = useStore.getState()

    try {
      originalState.setDefaultAfternoonTeaTitleCount(7)
      const persisted = getPersistedState(useStore.getState())
      const freshState = {
        ...originalState,
        afternoonTeaConversations: [],
        afternoonTeaConversationsLoaded: true,
        activeAfternoonTeaConversationId: null,
        afternoonTeaEditingConversationId: null,
        defaultAfternoonTeaTitleCount: DEFAULT_DISH_TITLE_COUNT,
      }

      expect(persisted).toHaveProperty('defaultAfternoonTeaTitleCount', 7)

      useStore.setState(mergePersistedState(persisted, freshState), true)
      const id = useStore.getState().createAfternoonTeaConversation({ force: true })

      expect(useStore.getState().defaultAfternoonTeaTitleCount).toBe(7)
      expect(useStore.getState().afternoonTeaConversations.find((item) => item.id === id)?.titleCount).toBe(7)
    } finally {
      useStore.setState(originalState, true)
    }
  })

  it('selects, updates, renames, and deletes conversations without deleting tasks', () => {
    const first = useStore.getState().createAfternoonTeaConversation()
    useStore.getState().updateAfternoonTeaConversation(first, {
      sourceImageId: 'source-a',
      sourceImageName: 'afternoon-tea.png',
      orderText: '草莓蛋糕和红茶',
      titleCount: 3,
      systemPrompt: '自定义系统提示词',
      analysisSystemPromptSnapshot: '完整分析系统提示词',
      analysisUserPromptSnapshot: '完整分析用户提示词',
      orderResult: { titles: ['午后茶歇'], items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }] },
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '海报提示词', taskId: 'task-a' }],
      batchStartedAt: 10,
      batchFinishedAt: 20,
    })
    const second = useStore.getState().createAfternoonTeaConversation()

    useStore.getState().setActiveAfternoonTeaConversationId(first)
    useStore.getState().renameAfternoonTeaConversation(first, '  周五茶歇  ')

    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(first)
    expect(useStore.getState().afternoonTeaConversations.find((conversation) => conversation.id === first)).toMatchObject({
      title: '周五茶歇',
      sourceImageId: 'source-a',
      orderText: '草莓蛋糕和红茶',
      titleCount: 3,
      analysisSystemPromptSnapshot: '完整分析系统提示词',
      analysisUserPromptSnapshot: '完整分析用户提示词',
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '海报提示词', taskId: 'task-a' }],
      batchStartedAt: 10,
      batchFinishedAt: 20,
    })

    useStore.getState().deleteAfternoonTeaConversation(first)

    expect(useStore.getState().afternoonTeaConversations.map((conversation) => conversation.id)).toEqual([second])
    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(second)
    expect(useStore.getState().tasks).toEqual([])
  })

  it('serializes IndexedDB replacement and persists the latest snapshot', async () => {
    let releaseFirstWrite = () => {}
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    vi.mocked(replaceAfternoonTeaConversations).mockImplementationOnce(async () => {
      await firstWrite
    })

    const id = useStore.getState().createAfternoonTeaConversation()
    useStore.getState().renameAfternoonTeaConversation(id, '第一次修改')
    useStore.getState().renameAfternoonTeaConversation(id, '最终标题')

    await vi.waitFor(() => expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(1))
    releaseFirstWrite()
    await vi.waitFor(() => expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(2))

    expect(vi.mocked(replaceAfternoonTeaConversations).mock.calls[1]?.[0]).toMatchObject([
      { id, title: '最终标题' },
    ])
  })

  it('retries the latest snapshot after a rejected IndexedDB replacement without leaking the rejection', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unhandledRejections: unknown[] = []
    const handleUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    const nodeProcess = (globalThis as typeof globalThis & {
      process: {
        on: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
        off: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
      }
    }).process
    nodeProcess.on('unhandledRejection', handleUnhandledRejection)

    try {
      vi.mocked(replaceAfternoonTeaConversations).mockRejectedValueOnce(new Error('indexeddb unavailable'))

      const id = useStore.getState().createAfternoonTeaConversation()
      await Promise.resolve()
      await Promise.resolve()

      expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith('下午茶会话持久化失败，将自动重试', expect.any(Error))

      useStore.getState().renameAfternoonTeaConversation(id, '失败后的修改')
      useStore.getState().renameAfternoonTeaConversation(id, '重试最终标题')
      expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(999)
      expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(2)
      expect(vi.mocked(replaceAfternoonTeaConversations).mock.calls[1]?.[0]).toMatchObject([
        { id, title: '重试最终标题' },
      ])
      expect(unhandledRejections).toEqual([])

      await vi.advanceTimersByTimeAsync(1_000)
      expect(replaceAfternoonTeaConversations).toHaveBeenCalledTimes(2)
    } finally {
      nodeProcess.off('unhandledRejection', handleUnhandledRejection)
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('loads normalized records and restores a valid active id or the newest record', async () => {
    const older = afternoonTeaConversation({ id: 'older', updatedAt: 10, createdAt: 10 })
    const newer = afternoonTeaConversation({ id: 'newer', title: '  ', updatedAt: 20, createdAt: 20, titleCount: 99 })
    useStore.setState({
      afternoonTeaConversations: [],
      afternoonTeaConversationsLoaded: false,
      activeAfternoonTeaConversationId: older.id,
    })
    await vi.waitFor(() => expect(replaceAfternoonTeaConversations).toHaveBeenCalled())
    await putAfternoonTeaConversation(older)
    await putAfternoonTeaConversation(newer)

    await initStore()

    expect(useStore.getState().afternoonTeaConversations).toMatchObject([
      { id: 'older' },
      { id: 'newer', title: '新下午茶会话', titleCount: 10 },
    ])
    expect(useStore.getState().afternoonTeaConversationsLoaded).toBe(true)
    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(older.id)

    useStore.setState({ activeAfternoonTeaConversationId: 'missing' })
    await initStore()

    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(newer.id)
  })

  it('fills and persists default item regions for a legacy IndexedDB record', async () => {
    const legacy = { ...afternoonTeaConversation({ id: 'legacy-region' }) } as Partial<AfternoonTeaConversation>
    delete legacy.itemTitleRegions
    await putAfternoonTeaConversation(legacy as AfternoonTeaConversation)

    await initStore()

    expect(useStore.getState().afternoonTeaConversations[0]?.itemTitleRegions)
      .toEqual([])
    await vi.waitFor(async () => expect((await getAllAfternoonTeaConversations())[0]?.itemTitleRegions)
      .toEqual([]))
  })

  it('reconciles and persists terminal afternoon tea batches after startup task recovery', async () => {
    const storedTask = task({ id: 'poster-done', status: 'done', finishedAt: 700 })
    await putDbTask(storedTask)
    await putAfternoonTeaConversation(afternoonTeaConversation({
      id: 'batch-recovered',
      posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: storedTask.id }],
      batchStartedAt: 100,
    }))

    await initStore()

    expect(useStore.getState().afternoonTeaConversations.find((item) => item.id === 'batch-recovered')?.batchFinishedAt).toBe(700)
    await vi.waitFor(async () => expect((await getAllAfternoonTeaConversations()).find((item) => item.id === 'batch-recovered')?.batchFinishedAt).toBe(700))
  })

  it('publishes loaded afternoon tea conversations only after startup batch reconciliation', async () => {
    useStore.setState({
      tasks: [],
      afternoonTeaConversationsLoaded: false,
      activeAfternoonTeaConversationId: null,
    })
    const storedTask = task({ id: 'poster-interrupted', status: 'running', finishedAt: null, elapsed: null })
    await putDbTask(storedTask)
    await putAfternoonTeaConversation(afternoonTeaConversation({
      id: 'batch-interrupted',
      posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: storedTask.id }],
      batchStartedAt: 100,
    }))
    const prematurelyPublished: AfternoonTeaConversation[] = []
    const unsubscribe = useStore.subscribe((state) => {
      const conversation = state.afternoonTeaConversations.find((item) => item.id === 'batch-interrupted')
      if (state.afternoonTeaConversationsLoaded && conversation && conversation.batchFinishedAt == null) {
        prematurelyPublished.push(conversation)
      }
    })

    try {
      await initStore()
    } finally {
      unsubscribe()
    }

    expect(prematurelyPublished).toEqual([])
    expect(useStore.getState().afternoonTeaConversationsLoaded).toBe(true)
    expect(useStore.getState().afternoonTeaConversations.find((item) => item.id === 'batch-interrupted')?.batchFinishedAt)
      .toEqual(expect.any(Number))
  })

  it('reconciles terminal task updates and external task deletion through conversation persistence', async () => {
    const running = task({ id: 'poster-running', status: 'running', finishedAt: null, elapsed: null })
    useStore.setState({
      tasks: [running],
      afternoonTeaConversations: [afternoonTeaConversation({
        id: 'batch-live',
        posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: running.id }],
        batchStartedAt: 100,
      })],
    })

    updateTaskInStore(running.id, { status: 'done', finishedAt: 600, elapsed: 500 })
    expect(useStore.getState().afternoonTeaConversations[0].batchFinishedAt).toBe(600)

    useStore.setState({
      tasks: [running],
      afternoonTeaConversations: [afternoonTeaConversation({
        id: 'batch-deleted',
        posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: running.id }],
        batchStartedAt: 100,
      })],
    })
    await removeTask(running)

    expect(useStore.getState().afternoonTeaConversations[0].batchFinishedAt).toEqual(expect.any(Number))
    await vi.waitFor(async () => expect((await getAllAfternoonTeaConversations())[0]?.batchFinishedAt).toEqual(expect.any(Number)))
  })

  it('reconciles batch deletion using only referenced tasks and preserves an existing finish', async () => {
    const referenced = task({ id: 'referenced', status: 'done', finishedAt: 700 })
    const extraSameBatch = task({ id: 'extra-same-batch', status: 'done', finishedAt: 9_000, afternoonTeaBatchId: 'batch-delete' })
    await putDbTask(referenced)
    await putDbTask(extraSameBatch)
    useStore.setState({
      tasks: [referenced, extraSameBatch],
      afternoonTeaConversations: [afternoonTeaConversation({
        id: 'batch-delete',
        posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: referenced.id }],
        batchStartedAt: 100,
      })],
    })

    await removeMultipleTasks([referenced.id])

    expect(useStore.getState().afternoonTeaConversations[0].batchFinishedAt).not.toBe(9_000)
    const finished = useStore.getState().afternoonTeaConversations[0].batchFinishedAt
    expect(finished).toEqual(expect.any(Number))

    const existingFinish = afternoonTeaConversation({
      id: 'batch-immutable',
      posterItems: [{ id: 'poster', title: '海报', prompt: 'prompt', taskId: extraSameBatch.id }],
      batchStartedAt: 100,
      batchFinishedAt: 500,
    })
    useStore.setState({
      tasks: [extraSameBatch],
      afternoonTeaConversations: [existingFinish],
    })
    await removeMultipleTasks([extraSameBatch.id])
    expect(useStore.getState().afternoonTeaConversations[0].batchFinishedAt).toBe(500)
    expect(finished).not.toBeNull()
  })

  it('persists only the active id in localStorage state and ignores injected records on merge', () => {
    const current = afternoonTeaConversation({ id: 'current' })
    useStore.setState({
      afternoonTeaConversations: [current],
      afternoonTeaConversationsLoaded: true,
      activeAfternoonTeaConversationId: current.id,
      afternoonTeaEditingConversationId: current.id,
    })

    const persisted = getPersistedState(useStore.getState())
    const restored = mergePersistedState({
      activeAfternoonTeaConversationId: 'stored-active',
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'injected' })],
      afternoonTeaConversationsLoaded: true,
      afternoonTeaEditingConversationId: 'injected',
    }, useStore.getState())

    expect(persisted).toMatchObject({ activeAfternoonTeaConversationId: current.id })
    expect(persisted).not.toHaveProperty('afternoonTeaConversations')
    expect(persisted).not.toHaveProperty('afternoonTeaConversationsLoaded')
    expect(persisted).not.toHaveProperty('afternoonTeaEditingConversationId')
    expect(restored.afternoonTeaConversations).toEqual([current])
    expect(restored.afternoonTeaConversationsLoaded).toBe(true)
    expect(restored.afternoonTeaEditingConversationId).toBeNull()
    expect(restored.activeAfternoonTeaConversationId).toBe('stored-active')
  })
})

describe('afternoon tea image references', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    await clearAfternoonTeaConversations()
    useStore.setState({
      tasks: [],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentConversations: [],
      agentConversationsLoaded: true,
      activeAgentConversationId: null,
      afternoonTeaConversations: [],
      afternoonTeaConversationsLoaded: true,
      activeAfternoonTeaConversationId: null,
      afternoonTeaEditingConversationId: null,
      showToast: vi.fn(),
    })
  })

  it('keeps parse-only source images and removes true orphan images during startup', async () => {
    await putImage({ id: 'parse-source', dataUrl: 'data:image/png;base64,source', source: 'upload' })
    await putImage({ id: 'orphan', dataUrl: 'data:image/png;base64,orphan', source: 'upload' })
    await putAfternoonTeaConversation(afternoonTeaConversation({
      id: 'parse-only',
      sourceImageId: 'parse-source',
      sourceImageName: 'menu.png',
      orderResult: { titles: ['下午茶'], items: [{ displayName: '蛋糕', tags: [] }] },
    }))

    await initStore()

    expect(await getImage('parse-source')).toBeDefined()
    expect(await getImage('orphan')).toBeUndefined()
  })

  it('keeps every task and Agent image reference field during startup cleanup', async () => {
    const imageIds = [
      'task-mask-target',
      'round-mask-target',
      'round-mask-image',
      'message-input',
      'message-mask-target',
      'message-mask-image',
    ]
    for (const id of imageIds) {
      await putImage({ id, dataUrl: `data:image/png;base64,${id}`, source: 'upload' })
    }
    await putDbTask(task({ id: 'mask-task', maskTargetImageId: 'task-mask-target' }))
    await putAgentConversation(agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        userMessageId: 'message-a',
        prompt: '参考图片',
        inputImageIds: [],
        maskTargetImageId: 'round-mask-target',
        maskImageId: 'round-mask-image',
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{
        id: 'message-a',
        role: 'user',
        content: '参考图片',
        roundId: 'round-a',
        inputImageIds: ['message-input'],
        maskTargetImageId: 'message-mask-target',
        maskImageId: 'message-mask-image',
        createdAt: 1,
      }],
    }))

    await initStore()

    for (const id of imageIds) expect(await getImage(id), id).toBeDefined()
  })

  it('keeps a historical afternoon tea source in generic unreferenced cleanup', async () => {
    await putImage({ id: 'history-source', dataUrl: 'data:image/png;base64,history', source: 'upload' })
    useStore.setState({
      afternoonTeaConversations: [afternoonTeaConversation({ sourceImageId: 'history-source' })],
    })

    await deleteImageIfUnreferenced('history-source')

    expect(await getImage('history-source')).toBeDefined()
  })

  it.each([
    ['a new afternoon tea conversation', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'new-reference', sourceImageId: imageId })],
    })],
    ['the current input', (imageId: string) => ({
      inputImages: [{ id: imageId, dataUrl: 'data:image/png;base64,race' }],
    })],
  ])('rechecks references at the database guard before deleting an image added to %s', async (_label, createState) => {
    const imageId = `race-${_label}`
    await putImage({ id: imageId, dataUrl: 'data:image/png;base64,race', source: 'upload' })
    let releaseGuard = () => {}
    const guardGate = new Promise<void>((resolve) => {
      releaseGuard = resolve
    })
    let notifyDeleteStarted = () => {}
    const deleteStarted = new Promise<void>((resolve) => {
      notifyDeleteStarted = resolve
    })
    const guardedDeleteImage = vi.mocked(deleteImage as unknown as (
      id: string,
      shouldDelete?: () => boolean,
    ) => Promise<boolean>)
    guardedDeleteImage.mockImplementationOnce(async (_id, shouldDelete) => {
      notifyDeleteStarted()
      await guardGate
      if (shouldDelete && !shouldDelete()) return false
      await clearImages()
      return true
    })

    const deletion = deleteImageIfUnreferenced(imageId)
    await deleteStarted
    useStore.setState(createState(imageId))
    releaseGuard()
    await deletion

    expect(await getImage(imageId)).toBeDefined()
  })

  it('keeps historical afternoon tea sources when deleting one or multiple tasks', async () => {
    const singleTask = task({ id: 'single-task', inputImageIds: ['single-source'] })
    const multipleTask = task({ id: 'multiple-task', inputImageIds: ['multiple-source'] })
    await putImage({ id: 'single-source', dataUrl: 'data:image/png;base64,single', source: 'upload' })
    await putImage({ id: 'multiple-source', dataUrl: 'data:image/png;base64,multiple', source: 'upload' })
    await putDbTask(singleTask)
    await putDbTask(multipleTask)
    useStore.setState({
      tasks: [singleTask, multipleTask],
      afternoonTeaConversations: [
        afternoonTeaConversation({ id: 'single-history', sourceImageId: 'single-source' }),
        afternoonTeaConversation({ id: 'multiple-history', sourceImageId: 'multiple-source' }),
      ],
    })

    await removeTask(singleTask)
    await removeMultipleTasks([multipleTask.id])

    expect(await getImage('single-source')).toBeDefined()
    expect(await getImage('multiple-source')).toBeDefined()
  })

  it('keeps an output image referenced as another task mask target when deleting one task', async () => {
    const deletedTask = task({ id: 'deleted-task', outputImages: ['shared-mask-target'] })
    const remainingTask = task({ id: 'remaining-task', maskTargetImageId: 'shared-mask-target' })
    await putImage({ id: 'shared-mask-target', dataUrl: 'data:image/png;base64,shared', source: 'generated' })
    await putDbTask(deletedTask)
    await putDbTask(remainingTask)
    useStore.setState({ tasks: [deletedTask, remainingTask] })

    await removeTask(deletedTask)

    expect(await getImage('shared-mask-target')).toBeDefined()
  })

  it('deletes an orphan task mask target when deleting its task', async () => {
    const deletedTask = task({ id: 'deleted-task', maskTargetImageId: 'orphan-mask-target' })
    await putImage({ id: 'orphan-mask-target', dataUrl: 'data:image/png;base64,orphan', source: 'upload' })
    await putDbTask(deletedTask)
    useStore.setState({ tasks: [deletedTask] })

    await removeTask(deletedTask)

    expect(await getImage('orphan-mask-target')).toBeUndefined()
  })

  it('keeps every Agent image reference field when deleting multiple tasks', async () => {
    const imageIds = [
      'round-input',
      'round-mask-target',
      'round-mask-image',
      'message-input',
      'message-mask-target',
      'message-mask-image',
    ]
    const deletedTasks = imageIds.map((id, index) => task({ id: `deleted-${index}`, outputImages: [id] }))
    for (const id of imageIds) {
      await putImage({ id, dataUrl: `data:image/png;base64,${id}`, source: 'generated' })
    }
    for (const value of deletedTasks) await putDbTask(value)
    useStore.setState({
      tasks: deletedTasks,
      agentConversations: [agentConversation({
        rounds: [{
          id: 'round-a',
          index: 1,
          userMessageId: 'message-a',
          prompt: '参考图片',
          inputImageIds: ['round-input'],
          maskTargetImageId: 'round-mask-target',
          maskImageId: 'round-mask-image',
          outputTaskIds: [],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [{
          id: 'message-a',
          role: 'user',
          content: '参考图片',
          roundId: 'round-a',
          inputImageIds: ['message-input'],
          maskTargetImageId: 'message-mask-target',
          maskImageId: 'message-mask-image',
          createdAt: 1,
        }],
      })],
    })

    await removeMultipleTasks(deletedTasks.map((item) => item.id))

    for (const id of imageIds) expect(await getImage(id), id).toBeDefined()
  })

  it('deletes an orphan source image after deleting its conversation', async () => {
    await putImage({ id: 'orphan-source', dataUrl: 'data:image/png;base64,orphan', source: 'upload' })
    useStore.setState({
      afternoonTeaConversations: [afternoonTeaConversation({ sourceImageId: 'orphan-source' })],
    })

    await useStore.getState().deleteAfternoonTeaConversation('afternoon-tea-a')

    expect(useStore.getState().afternoonTeaConversations).toEqual([])
    expect(await getImage('orphan-source')).toBeUndefined()
  })

  it.each([
    ['another conversation', (imageId: string) => ({
      afternoonTeaConversations: [
        afternoonTeaConversation({ id: 'target', sourceImageId: imageId }),
        afternoonTeaConversation({ id: 'shared', sourceImageId: imageId }),
      ],
    })],
    ['a task', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'target', sourceImageId: imageId })],
      tasks: [task({ id: 'shared-task', inputImageIds: [imageId] })],
    })],
    ['the current input', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'target', sourceImageId: imageId })],
      inputImages: [{ id: imageId, dataUrl: 'data:image/png;base64,shared' }],
    })],
    ['the gallery draft', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'target', sourceImageId: imageId })],
      galleryInputDraft: {
        prompt: '',
        inputImages: [{ id: imageId, dataUrl: 'data:image/png;base64,shared' }],
        params: { ...DEFAULT_PARAMS },
      },
    })],
    ['an Agent draft', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'target', sourceImageId: imageId })],
      agentInputDrafts: {
        'agent-a': {
          prompt: '',
          inputImages: [{ id: imageId, dataUrl: 'data:image/png;base64,shared' }],
          maskDraft: null,
          maskEditorImageId: null,
        },
      },
    })],
    ['an Agent conversation', (imageId: string) => ({
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'target', sourceImageId: imageId })],
      agentConversations: [agentConversation({
        messages: [{
          id: 'message-a',
          role: 'user',
          content: '参考图片',
          roundId: 'round-a',
          inputImageIds: [imageId],
          createdAt: 1,
        }],
      })],
    })],
  ])('keeps a deleted conversation source still referenced by %s', async (_label, createState) => {
    const imageId = `shared-${_label}`
    await putImage({ id: imageId, dataUrl: 'data:image/png;base64,shared', source: 'upload' })
    useStore.setState(createState(imageId))

    await useStore.getState().deleteAfternoonTeaConversation('target')

    expect(await getImage(imageId)).toBeDefined()
  })

  it('deletes only the conversation by default and keeps its related tasks', async () => {
    const relatedTask = task({
      id: 'poster-task',
      afternoonTeaBatchId: 'afternoon-tea-a',
      inputImageIds: ['default-source'],
      outputImages: ['default-output'],
    })
    await putImage({ id: 'default-source', dataUrl: 'data:image/png;base64,source', source: 'upload' })
    await putImage({ id: 'default-output', dataUrl: 'data:image/png;base64,output', source: 'generated' })
    await putDbTask(relatedTask)
    useStore.setState({
      tasks: [relatedTask],
      afternoonTeaConversations: [afternoonTeaConversation({
        sourceImageId: 'default-source',
        posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt', taskId: relatedTask.id }],
      })],
    })

    const deletion = useStore.getState().deleteAfternoonTeaConversation('afternoon-tea-a')

    expect(useStore.getState().afternoonTeaConversations).toEqual([])
    await deletion
    expect(useStore.getState().tasks.map((item) => item.id)).toEqual([relatedTask.id])
    expect((await getAllTasks()).map((item) => item.id)).toEqual([relatedTask.id])
    expect(await getImage('default-source')).toBeDefined()
    expect(await getImage('default-output')).toBeDefined()
  })

  it('optionally deletes poster and matching batch tasks before cleaning generated images and source', async () => {
    const posterTask = task({
      id: 'poster-task',
      inputImageIds: ['batch-source'],
      outputImages: ['poster-output'],
    })
    const batchTask = task({
      id: 'batch-task',
      afternoonTeaBatchId: 'afternoon-tea-a',
      inputImageIds: ['batch-source'],
      outputImages: ['batch-output'],
    })
    const unrelatedTask = task({ id: 'unrelated-task', outputImages: ['unrelated-output'] })
    for (const [id, source] of [
      ['batch-source', 'upload'],
      ['poster-output', 'generated'],
      ['batch-output', 'generated'],
      ['unrelated-output', 'generated'],
    ] as const) {
      await putImage({ id, dataUrl: `data:image/png;base64,${id}`, source })
    }
    for (const value of [posterTask, batchTask, unrelatedTask]) await putDbTask(value)
    useStore.setState({
      tasks: [posterTask, batchTask, unrelatedTask],
      afternoonTeaConversations: [afternoonTeaConversation({
        sourceImageId: 'batch-source',
        posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt', taskId: posterTask.id }],
      })],
    })

    await useStore.getState().deleteAfternoonTeaConversation('afternoon-tea-a', true)

    expect(useStore.getState().afternoonTeaConversations).toEqual([])
    expect(useStore.getState().tasks.map((item) => item.id)).toEqual([unrelatedTask.id])
    expect((await getAllTasks()).map((item) => item.id)).toEqual([unrelatedTask.id])
    expect(await getImage('batch-source')).toBeUndefined()
    expect(await getImage('poster-output')).toBeUndefined()
    expect(await getImage('batch-output')).toBeUndefined()
    expect(await getImage('unrelated-output')).toBeDefined()
  })

  it('clears afternoon tea persistence and state with task data but preserves it for config-only clearing', async () => {
    const conversation = afternoonTeaConversation({ id: 'clear-me', sourceImageId: 'clear-source' })
    await putAfternoonTeaConversation(conversation)
    await putImage({ id: 'clear-source', dataUrl: 'data:image/png;base64,clear', source: 'upload' })
    useStore.setState({
      afternoonTeaConversations: [conversation],
      activeAfternoonTeaConversationId: conversation.id,
      afternoonTeaEditingConversationId: conversation.id,
    })

    await clearData({ clearConfig: true, clearTasks: false })

    expect(useStore.getState().afternoonTeaConversations).toEqual([conversation])
    expect(await getImage('clear-source')).toBeDefined()

    await clearData({ clearConfig: false, clearTasks: true })

    expect(useStore.getState()).toMatchObject({
      afternoonTeaConversations: [],
      activeAfternoonTeaConversationId: null,
      afternoonTeaEditingConversationId: null,
    })
    expect(await getImage('clear-source')).toBeUndefined()
    await vi.waitFor(async () => expect(await getAllAfternoonTeaConversations()).toEqual([]))
  })
})

describe('persisted afternoon tea poster tasks', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    vi.mocked(callImageApi).mockReset()
    vi.mocked(callImageApi).mockResolvedValue({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    vi.mocked(putDbTask).mockClear()
    vi.mocked(storeImage).mockClear()
    vi.mocked(showBrowserNotification).mockClear()
    useStore.setState({
      settings: afternoonTeaSettings(createDefaultOpenAIProfile({
        id: 'gallery-profile',
        name: '当前画廊配置',
        baseUrl: 'https://gallery.example.com/v1',
        apiKey: 'gallery-key',
        model: 'gallery-image-model',
        apiProxy: false,
      })),
      prompt: '保留画廊提示词',
      inputImages: [imageB],
      params: { ...DEFAULT_PARAMS, n: 4, quality: 'low' },
      tasks: [],
      detailTaskId: null,
      confirmDialog: null,
      showToast: vi.fn(),
    })
  })

  it.each([
    ['API URL', { baseUrl: '' }, '缺少 API URL'],
    ['API Key', { apiKey: '' }, '缺少 API Key'],
    ['图片模型', { model: '' }, '缺少模型 ID'],
  ])('validates the OpenAI %s before creating a task', async (_label, profilePatch, expectedError) => {
    const profile = createDefaultOpenAIProfile({
      id: 'invalid-openai-profile',
      name: '无效 OpenAI 配置',
      baseUrl: 'https://snapshot.example.com/v1',
      apiKey: 'snapshot-secret',
      model: 'snapshot-image-model',
      apiProxy: false,
      ...profilePatch,
    })
    const onTaskCreated = vi.fn()

    await expect(submitAfternoonTeaPosterTask(afternoonTeaOptions(afternoonTeaSettings(profile), { onTaskCreated })))
      .rejects.toThrow(expectedError)

    expect(useStore.getState().tasks).toEqual([])
    expect(await getAllTasks()).toEqual([])
    expect(onTaskCreated).not.toHaveBeenCalled()
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('rejects a non-OpenAI active profile before creating a task', async () => {
    const profile = createDefaultFalProfile({
      id: 'fal-profile',
      name: 'fal 配置',
      apiKey: 'fal-secret',
    })
    const onTaskCreated = vi.fn()

    await expect(submitAfternoonTeaPosterTask(afternoonTeaOptions(afternoonTeaSettings(profile), { onTaskCreated })))
      .rejects.toThrow('OpenAI')

    expect(useStore.getState().tasks).toEqual([])
    expect(await getAllTasks()).toEqual([])
    expect(onTaskCreated).not.toHaveBeenCalled()
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('removes a task from memory when its initial persistence fails', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'initial-persist-failure-profile',
      name: '初始持久化失败配置',
      baseUrl: 'https://snapshot.example.com/v1',
      apiKey: 'snapshot-key',
      model: 'snapshot-model',
      apiProxy: false,
    })
    const onTaskCreated = vi.fn()
    vi.mocked(putDbTask).mockRejectedValueOnce(new Error('indexeddb write failed'))

    await expect(submitAfternoonTeaPosterTask(afternoonTeaOptions(afternoonTeaSettings(profile), { onTaskCreated })))
      .rejects.toThrow('indexeddb write failed')

    expect(useStore.getState().tasks).toEqual([])
    expect(await getAllTasks()).toEqual([])
    expect(onTaskCreated).not.toHaveBeenCalled()
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('marks a task as a safe error when onTaskCreated throws', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'callback-failure-profile',
      name: '回调失败配置',
      baseUrl: 'https://snapshot.example.com/v1',
      apiKey: 'snapshot-key',
      model: 'snapshot-model',
      apiProxy: false,
    })
    const onTaskCreated = vi.fn(() => {
      throw new Error('callback secret must not be persisted')
    })

    await expect(submitAfternoonTeaPosterTask(afternoonTeaOptions(afternoonTeaSettings(profile), { onTaskCreated })))
      .rejects.toThrow('callback secret must not be persisted')

    const [memoryTask] = useStore.getState().tasks
    const [persistedTask] = await getAllTasks()
    expect(memoryTask).toMatchObject({
      status: 'error',
      error: '下午茶任务创建失败',
      finishedAt: expect.any(Number),
      elapsed: expect.any(Number),
    })
    expect(persistedTask).toMatchObject({
      id: memoryTask.id,
      status: 'error',
      error: '下午茶任务创建失败',
      finishedAt: expect.any(Number),
      elapsed: expect.any(Number),
    })
    expect(persistedTask.error).not.toContain('callback secret')
    expect(putDbTask).toHaveBeenCalledTimes(2)
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('persists explicit task data, calls onTaskCreated after persistence, and waits for done', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'snapshot-openai-profile',
      name: '快照 OpenAI 配置',
      baseUrl: 'https://snapshot.example.com/v1',
      apiKey: 'snapshot-secret-do-not-persist',
      model: 'snapshot-image-model',
      apiProxy: false,
    })
    const settingsSnapshot = afternoonTeaSettings(profile)
    const galleryDraft = {
      prompt: useStore.getState().prompt,
      inputImages: useStore.getState().inputImages,
      params: useStore.getState().params,
    }
    await putImage({ ...imageA, source: 'upload', createdAt: 1 })
    vi.mocked(storeImage).mockClear()

    let resolveApi!: (result: Awaited<ReturnType<typeof callImageApi>>) => void
    vi.mocked(callImageApi).mockImplementationOnce(() => new Promise((resolve) => {
      resolveApi = resolve
    }))
    let persistedAtCallback: Promise<TaskRecord[]> | null = null
    let notifyCreated!: () => void
    const created = new Promise<void>((resolve) => {
      notifyCreated = resolve
    })
    const changedSettings = afternoonTeaSettings(createDefaultOpenAIProfile({
      id: 'changed-profile',
      name: '排队后切换的配置',
      baseUrl: 'https://changed.example.com/v1',
      apiKey: 'changed-key',
      model: 'changed-model',
      apiProxy: true,
    }))
    const onTaskCreated = vi.fn(() => {
      persistedAtCallback = getAllTasks()
      useStore.setState({ settings: changedSettings })
      notifyCreated()
    })
    let settled = false

    const submission = submitAfternoonTeaPosterTask(afternoonTeaOptions(settingsSnapshot, {
      paramsSnapshot: {
        ...DEFAULT_PARAMS,
        size: '768x1024',
        quality: 'high',
        output_format: 'jpeg',
        output_compression: 72,
        n: 8,
        transparent_output: true,
      },
      onTaskCreated,
    }))
    submission.then(() => {
      settled = true
    })

    await created
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalledTimes(1))

    const persisted = await persistedAtCallback!
    expect(persisted).toHaveLength(1)
    expect(onTaskCreated).toHaveBeenCalledWith(persisted[0].id)
    expect(persisted[0]).toMatchObject({
      prompt: '生成夏日下午茶海报',
      params: {
        size: '768x1024',
        quality: 'high',
        output_format: 'jpeg',
        output_compression: 72,
        moderation: 'auto',
        n: 1,
        transparent_output: false,
      },
      apiProvider: 'openai',
      apiProfileId: profile.id,
      apiProfileName: profile.name,
      apiMode: profile.apiMode,
      apiModel: profile.model,
      inputImageIds: [imageA.id],
      afternoonTeaBatchId: 'afternoon-tea-batch-a',
      afternoonTeaTitle: '夏日下午茶',
      status: 'running',
    })
    expect(JSON.stringify(persisted[0])).not.toContain(profile.apiKey)
    expect(storeImage).not.toHaveBeenCalled()
    expect(useStore.getState()).toMatchObject(galleryDraft)
    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        activeProfileId: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
      }),
      prompt: '生成夏日下午茶海报',
      sendPromptAsIs: true,
      params: expect.objectContaining({ size: '768x1024', n: 1, transparent_output: false }),
      inputImageDataUrls: [imageA.dataUrl],
    }))
    expect(settled).toBe(false)

    resolveApi({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    const result = await submission

    expect(result.taskId).toBe(persisted[0].id)
    expect(result.task).toBe(useStore.getState().tasks.find((item) => item.id === result.taskId))
    expect(result.task).toMatchObject({ status: 'done', error: null })
    expect((await getAllTasks()).find((item) => item.id === result.taskId)).toMatchObject({ status: 'done' })
    expect(JSON.stringify(result.task)).not.toContain(profile.apiKey)
    expect(useStore.getState().showToast).not.toHaveBeenCalled()
    expect(showBrowserNotification).not.toHaveBeenCalled()
    expect(useStore.getState().detailTaskId).toBeNull()
  })

  it('uses the same settings snapshot for request errors without opening per-task UI', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'proxy-snapshot-profile',
      name: '代理快照配置',
      baseUrl: 'https://proxy-target.example.com/v1',
      apiKey: 'proxy-snapshot-secret',
      model: 'proxy-snapshot-model',
      apiProxy: true,
    })
    const settingsSnapshot = afternoonTeaSettings(profile)
    await putImage({ ...imageA, source: 'upload', createdAt: 1 })
    vi.mocked(callImageApi).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const changedSettings = afternoonTeaSettings(createDefaultOpenAIProfile({
      id: 'direct-profile',
      name: '当前直连配置',
      baseUrl: 'https://direct.example.com/v1',
      apiKey: 'direct-key',
      model: 'direct-model',
      apiProxy: false,
    }))

    const result = await submitAfternoonTeaPosterTask(afternoonTeaOptions(settingsSnapshot, {
      onTaskCreated: () => useStore.setState({ settings: changedSettings }),
    }))

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        activeProfileId: profile.id,
        apiKey: profile.apiKey,
        apiProxy: true,
      }),
    }))
    expect(result.task.status).toBe('error')
    expect(result.task.error).toContain('请检查 API 代理服务是否正常运行')
    expect(result.task.error).not.toContain('浏览器跨域')
    expect(useStore.getState().detailTaskId).toBeNull()
    expect(useStore.getState().showToast).not.toHaveBeenCalled()
    expect(showBrowserNotification).not.toHaveBeenCalled()
    expect(JSON.stringify(await getAllTasks())).not.toContain(profile.apiKey)
  })

  it.each([
    ['rewrites the prompt', ['改写后的下午茶海报提示词']],
    ['omits the revised prompt', []],
  ])('skips the per-task Codex CLI prompt when a Responses batch %s', async (_case, revisedPrompts) => {
    const profile = createDefaultOpenAIProfile({
      id: 'batch-responses-profile',
      name: '批次 Responses 配置',
      baseUrl: 'https://snapshot.example.com/v1',
      apiKey: 'snapshot-key',
      model: 'snapshot-model',
      apiMode: 'responses',
      codexCli: false,
    })
    const changedProfile = createDefaultOpenAIProfile({
      id: 'changed-responses-profile',
      name: '排队后切换的 Responses 配置',
      baseUrl: 'https://changed.example.com/v1',
      apiKey: 'changed-key',
      model: 'changed-model',
      apiMode: 'responses',
      codexCli: false,
    })
    await putImage({ ...imageA, source: 'upload', createdAt: 1 })
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts,
    })

    const result = await submitAfternoonTeaPosterTask(afternoonTeaOptions(afternoonTeaSettings(profile), {
      onTaskCreated: () => useStore.setState({ settings: afternoonTeaSettings(changedProfile) }),
    }))

    expect(result.task.status).toBe('done')
    expect(useStore.getState().confirmDialog).toBeNull()
  })

  it('keeps the Codex CLI prompt for an ordinary Responses gallery task', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'gallery-responses-profile',
      name: '普通 Responses 配置',
      baseUrl: 'https://gallery.example.com/v1',
      apiKey: 'gallery-key',
      model: 'gallery-model',
      apiMode: 'responses',
      codexCli: false,
    })
    useStore.setState({
      settings: afternoonTeaSettings(profile),
      prompt: '普通画廊任务',
      inputImages: [],
      params: { ...DEFAULT_PARAMS },
      confirmDialog: null,
    })
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: ['普通画廊任务（已改写）'],
    })

    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().confirmDialog?.title).toBe('检测到 Codex CLI API'))
  })
})

describe('data operation locking', () => {
  it('detects running and recoverable work before import or export', () => {
    expect(hasActiveDataOperations([task({ status: 'running' })], [])).toBe(true)
    expect(hasActiveDataOperations([task({ falRecoverable: true })], [])).toBe(true)
    expect(hasActiveDataOperations([], [agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
    })])).toBe(true)
    expect(hasActiveDataOperations([task()], [])).toBe(false)
  })
})

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([collectionB.id])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it('fans out gallery submit across imageGenerationProfileIds with a shared generationGroupId', async () => {
    const first = createDefaultOpenAIProfile({ id: 'relay-a', name: '中转 A', apiKey: 'key-a', model: 'model-a' })
    const second = createDefaultOpenAIProfile({ id: 'relay-b', name: '中转 B', apiKey: 'key-b', model: 'model-b' })
    const settings = normalizeSettings({
      profiles: [first, second],
      activeProfileId: first.id,
      imageGenerationProfileIds: [first.id, second.id],
    })
    useStore.setState({
      settings,
      prompt: '并行提示词',
      params: { ...DEFAULT_PARAMS, n: 1 },
      tasks: [],
      showToast: vi.fn(),
    })

    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(2)
    expect(state.tasks.map((task) => task.apiProfileId).sort()).toEqual(['relay-a', 'relay-b'])
    expect(state.tasks[0].generationGroupId).toBeTruthy()
    expect(state.tasks[0].generationGroupId).toBe(state.tasks[1].generationGroupId)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交（2 个中转站并行）', 'success')
  })

  it('does not fan out when reusing a temporary task API profile', async () => {
    const first = createDefaultOpenAIProfile({ id: 'relay-a', name: '中转 A', apiKey: 'key-a', model: 'model-a' })
    const second = createDefaultOpenAIProfile({ id: 'relay-b', name: '中转 B', apiKey: 'key-b', model: 'model-b' })
    const settings = normalizeSettings({
      profiles: [first, second],
      activeProfileId: first.id,
      imageGenerationProfileIds: [first.id, second.id],
      reuseTaskApiProfileTemporarily: true,
    })
    useStore.setState({
      settings,
      prompt: '复用提示词',
      params: { ...DEFAULT_PARAMS, n: 1 },
      tasks: [],
      reusedTaskApiProfileId: second.id,
      reusedTaskApiProfileName: second.name,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
    })

    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0].apiProfileId).toBe('relay-b')
    expect(state.tasks[0].generationGroupId).toBeUndefined()
  })

  it('stores decoded image size as actual size when the API omits size', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams).toMatchObject({ size: '1254x1254', output_format: 'png', n: 1 })
    expect(task.actualParamsByImage?.[task.outputImages[0]]).toMatchObject({ size: '1254x1254', output_format: 'png' })
    await clearTasks()
    await clearImages()
  })

  it('keeps API-returned actual size over decoded image size', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png', size: '1024x1024' },
      actualParamsList: [{ output_format: 'png', size: '1024x1024' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams?.size).toBe('1024x1024')
    expect(task.actualParamsByImage?.[task.outputImages[0]].size).toBe('1024x1024')
    await clearTasks()
    await clearImages()
  })

  it('stores transparent background output after local post-processing', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'transparent:单主体贴纸素材',
      params: expect.objectContaining({
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,generated')
    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      prompt: '单主体贴纸素材',
      transparentOutput: true,
      transparentPrompt: 'transparent:单主体贴纸素材',
      status: 'done',
    })
    expect(task.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(task.outputImages[0])
    const originalImage = await getImage(task.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,generated')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,generated')
    await clearTasks()
    await clearImages()
  })

  it('falls back to the original output when transparent post-processing fails', async () => {
    const { callImageApi } = await import('./lib/api')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockRejectedValueOnce(new Error('post-process failed'))
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      transparentOutput: true,
      status: 'done',
    })
    expect(task.transparentOriginalImages).toEqual([''])
    const outputImage = await getImage(task.outputImages[0])
    expect(outputImage?.dataUrl).toBe('data:image/png;base64,generated')
    warnSpy.mockRestore()
    await clearTasks()
    await clearImages()
  })

  it('supports transparent background post-processing for fal gallery tasks', async () => {
    const { callImageApi } = await import('./lib/api')
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      prompt: '单主体图标素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        output_format: 'png',
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-generated')
    const [task] = useStore.getState().tasks
    expect(task.apiProvider).toBe('fal')
    expect(task.transparentOutput).toBe(true)
    expect(task.transparentOriginalImages).toHaveLength(1)
    await clearTasks()
    await clearImages()
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('gallery multi-image submission', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await putImage({ ...imageA, source: 'upload', createdAt: 1 })
    const profile = createDefaultOpenAIProfile({ id: 'gallery-multi-profile', apiKey: 'test-key' })
    vi.mocked(callImageApi).mockReset()
    vi.mocked(callImageApi).mockResolvedValue({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        profiles: [profile],
        activeProfileId: profile.id,
        clearInputAfterSubmit: true,
      }),
      prompt: '生成两张图片',
      inputImages: [imageA],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS, n: 2 },
      tasks: [],
      showToast: vi.fn(),
      confirmDialog: null,
    })
  })

  it('creates one concurrent gallery task per requested image without changing the selected count', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
    let resolveSecond!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
    const firstResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((resolve) => {
      resolveFirst = resolve
    })
    const secondResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(callImageApi)
      .mockImplementationOnce(() => firstResult)
      .mockImplementationOnce(() => secondResult)

    await submitTask()
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalledTimes(2))

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(2)
    expect(state.tasks.map((item) => item.params.n)).toEqual([1, 1])
    expect(state.tasks.every((item) => item.inputImageIds[0] === imageA.id)).toBe(true)
    expect(state.tasks.every((item) => item.apiProfileId === state.settings.activeProfileId)).toBe(true)
    expect(state.params.n).toBe(2)
    expect(state.inputImages).toEqual([])
    expect(state.showToast).toHaveBeenCalledTimes(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
    expect(callImageApi).toHaveBeenNthCalledWith(1, expect.objectContaining({
      params: expect.objectContaining({ n: 1 }),
    }))
    expect(callImageApi).toHaveBeenNthCalledWith(2, expect.objectContaining({
      params: expect.objectContaining({ n: 1 }),
    }))

    const emptyResult = {
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    }
    resolveFirst(emptyResult)
    resolveSecond(emptyResult)
    await vi.waitFor(() => expect(useStore.getState().tasks.every((item) => item.status === 'done')).toBe(true))
  })

  it('shows a later task as soon as it succeeds and keeps it when another task fails', async () => {
    let rejectFirst!: (reason?: unknown) => void
    let resolveSecond!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
    const firstResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((_, reject) => {
      rejectFirst = reject
    })
    const secondResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(callImageApi)
      .mockImplementationOnce(() => firstResult)
      .mockImplementationOnce(() => secondResult)

    await submitTask()
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalledTimes(2))
    const [firstTask, secondTask] = useStore.getState().tasks

    resolveSecond({
      images: ['data:image/png;base64,second-512x512'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    await vi.waitFor(() => {
      expect(useStore.getState().tasks.find((item) => item.id === secondTask.id)?.status).toBe('done')
    })
    expect(useStore.getState().tasks.find((item) => item.id === firstTask.id)?.status).toBe('running')
    expect(useStore.getState().tasks.find((item) => item.id === secondTask.id)?.outputImages).toHaveLength(1)

    rejectFirst(new Error('first request failed'))
    await vi.waitFor(() => {
      expect(useStore.getState().tasks.find((item) => item.id === firstTask.id)?.status).toBe('error')
    })
    expect(useStore.getState().tasks.find((item) => item.id === secondTask.id)).toMatchObject({
      status: 'done',
      error: null,
    })
    expect(useStore.getState().tasks.find((item) => item.id === secondTask.id)?.outputImages).toHaveLength(1)
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })

  it('keeps server-managed OpenAI tasks running for startup recovery', () => {
    const serverRunning = task({
      id: 'server-running',
      apiProvider: 'openai',
      executionMode: 'server',
      status: 'running',
      finishedAt: null,
      elapsed: null,
    })

    const result = markInterruptedOpenAIRunningTasks([serverRunning], 10_000)

    expect(result.interruptedTasks).toEqual([])
    expect(result.tasks).toEqual([serverRunning])
  })
})

describe('server-managed image jobs', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    vi.mocked(getImageJobExecutionPreference).mockReset()
    vi.mocked(getImageJobExecutionPreference).mockResolvedValue({ executionMode: 'server', requiresConfirmation: false })
    vi.mocked(getImageJob).mockReset()
    vi.mocked(submitImageJob).mockReset()
    vi.mocked(callImageApi).mockClear()
    const profile = createDefaultOpenAIProfile({ id: 'server-profile', apiKey: 'test-key' })
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id }),
      prompt: '后台生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      galleryInputDraft: null,
      agentConversations: [],
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: useStore.getInitialState().setConfirmDialog,
    })
  })

  it('submits an OpenAI task to the server and imports the completed output', async () => {
    vi.mocked(submitImageJob).mockResolvedValue({
      id: 'ignored-by-store',
      status: 'running',
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      error: null,
      resultUrls: [],
    })
    vi.mocked(getImageJob).mockResolvedValue({
      id: 'ignored-by-store',
      status: 'done',
      createdAt: 1,
      startedAt: 1,
      finishedAt: 2,
      error: null,
      resultUrls: ['/api/job-files/task/output-1.png'],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['后台改写'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['server-image'], { type: 'image/png' }))))

    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('done'))

    const completed = useStore.getState().tasks[0]
    expect(completed.executionMode).toBe('server')
    expect(submitImageJob).toHaveBeenCalledWith(completed.id, expect.objectContaining({
      prompt: '后台生成',
      profile: expect.objectContaining({ apiKey: 'test-key' }),
    }))
    expect(callImageApi).not.toHaveBeenCalled()
    expect((await getImage(completed.outputImages[0]))?.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('recovers a persisted server task during init without a provider resubmission', async () => {
    const running = task({
      id: 'server-recovery',
      apiProvider: 'openai',
      executionMode: 'server',
      status: 'running',
      finishedAt: null,
      elapsed: null,
    })
    await putDbTask(running)
    vi.mocked(getImageJob).mockResolvedValue({
      id: running.id,
      status: 'done',
      createdAt: 1,
      startedAt: 1,
      finishedAt: 2,
      error: null,
      resultUrls: ['/api/job-files/server-recovery/output-1.png'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['recovered'], { type: 'image/png' }))))

    await initStore()
    await vi.waitFor(() => expect(useStore.getState().tasks.find((item) => item.id === running.id)?.status).toBe('done'))

    expect(submitImageJob).not.toHaveBeenCalled()
    expect(useStore.getState().tasks.find((item) => item.id === running.id)?.outputImages).toHaveLength(1)
  })

  it('requires confirmation before direct browser fallback', async () => {
    vi.mocked(getImageJobExecutionPreference).mockResolvedValue({ executionMode: 'browser', requiresConfirmation: true })

    await submitTask()

    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().confirmDialog).toMatchObject({
      title: '后台任务服务不可用',
      confirmText: '仍在浏览器中生成',
    })

    useStore.getState().confirmDialog?.action?.()
    await vi.waitFor(() => expect(useStore.getState().tasks).toHaveLength(1))
    expect(useStore.getState().tasks[0].executionMode).toBe('browser')
  })

  it('retries an OpenAI task through the server when the job API is available', async () => {
    vi.mocked(submitImageJob).mockResolvedValue({
      id: 'retry-server',
      status: 'error',
      createdAt: 1,
      startedAt: 1,
      finishedAt: 2,
      error: 'stopped for test',
      resultUrls: [],
    })

    await retryTask(task({ id: 'failed-openai', apiProvider: 'openai', status: 'error', error: 'failed' }))

    const retried = useStore.getState().tasks[0]
    expect(getImageJobExecutionPreference).toHaveBeenCalledTimes(1)
    expect(retried.executionMode).toBe('server')
    await vi.waitFor(() => expect(submitImageJob).toHaveBeenCalledWith(retried.id, expect.any(Object)))
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('requires confirmation before retrying an OpenAI task in the browser', async () => {
    vi.mocked(getImageJobExecutionPreference).mockResolvedValue({ executionMode: 'browser', requiresConfirmation: true })

    await retryTask(task({ id: 'failed-openai', apiProvider: 'openai', status: 'error', error: 'failed' }))

    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().confirmDialog).toMatchObject({
      title: '后台任务服务不可用',
      confirmText: '仍在浏览器中生成',
    })

    useStore.getState().confirmDialog?.action?.()
    await vi.waitFor(() => expect(useStore.getState().tasks).toHaveLength(1))
    expect(getImageJobExecutionPreference).toHaveBeenCalledTimes(1)
    expect(useStore.getState().tasks[0].executionMode).toBe('browser')
  })

  it('keeps fal retries in the browser without checking the job API', async () => {
    const profile = createDefaultFalProfile({ id: 'retry-fal', apiKey: 'fal-key' })
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id }),
    })

    await retryTask(task({ id: 'failed-fal', apiProvider: 'fal', status: 'error', error: 'failed' }))

    expect(getImageJobExecutionPreference).not.toHaveBeenCalled()
    expect(useStore.getState().tasks[0].executionMode).toBe('browser')
  })

  it('keeps custom-provider retries in the browser without checking the job API', async () => {
    const provider = {
      id: 'retry-custom',
      name: 'Retry Custom',
      submit: { path: 'images/generations' },
    }
    const profile = createDefaultOpenAIProfile({
      id: 'retry-custom-profile',
      provider: provider.id,
      apiKey: 'custom-key',
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        customProviders: [provider],
        profiles: [profile],
        activeProfileId: profile.id,
      }),
    })

    await retryTask(task({ id: 'failed-custom', apiProvider: provider.id, status: 'error', error: 'failed' }))

    expect(getImageJobExecutionPreference).not.toHaveBeenCalled()
    expect(useStore.getState().tasks[0].executionMode).toBe('browser')
  })

  it.each([
    ['single deletion', async (running: TaskRecord) => removeTask(running)],
    ['multiple deletion', async (running: TaskRecord) => removeMultipleTasks([running.id])],
  ])('cancels scheduled server recovery after %s', async (_label, remove) => {
    vi.useFakeTimers()
    try {
      const running = task({
        id: `server-${_label}`,
        apiProvider: 'openai',
        executionMode: 'server',
        status: 'running',
        finishedAt: null,
        elapsed: null,
      })
      await putDbTask(running)

      await initStore()
      expect(vi.getTimerCount()).toBe(1)
      await remove(running)

      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(getImageJob).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels every scheduled server recovery when clearing tasks', async () => {
    vi.useFakeTimers()
    try {
      const runningTasks = ['server-clear-a', 'server-clear-b'].map((id) => task({
        id,
        apiProvider: 'openai',
        executionMode: 'server',
        status: 'running',
        finishedAt: null,
        elapsed: null,
      }))
      for (const running of runningTasks) await putDbTask(running)

      await initStore()
      expect(vi.getTimerCount()).toBe(2)
      await clearData({ clearConfig: false, clearTasks: true })

      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(getImageJob).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not query or reschedule after deleting a task with an in-flight server submission', async () => {
    let rejectSubmission!: (reason?: unknown) => void
    vi.mocked(submitImageJob).mockReturnValue(new Promise((_, reject) => {
      rejectSubmission = reject
    }))

    await submitTask()
    await vi.waitFor(() => expect(submitImageJob).toHaveBeenCalledTimes(1))
    const running = useStore.getState().tasks[0]
    await removeTask(running)

    rejectSubmission(new TypeError('Failed to fetch'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getImageJob).not.toHaveBeenCalled()
  })

  it('does not reschedule after deleting a task with an in-flight server recovery', async () => {
    vi.useFakeTimers()
    try {
      let resolveJob!: (job: Awaited<ReturnType<typeof getImageJob>>) => void
      vi.mocked(getImageJob).mockReturnValue(new Promise((resolve) => {
        resolveJob = resolve
      }))
      const running = task({
        id: 'server-in-flight-recovery',
        apiProvider: 'openai',
        executionMode: 'server',
        status: 'running',
        finishedAt: null,
        elapsed: null,
      })
      await putDbTask(running)

      await initStore()
      await vi.advanceTimersByTimeAsync(0)
      expect(getImageJob).toHaveBeenCalledTimes(1)
      await removeTask(running)

      resolveJob({
        id: running.id,
        status: 'running',
        createdAt: 1,
        startedAt: 1,
        finishedAt: null,
        error: null,
        resultUrls: [],
      })
      await vi.advanceTimersByTimeAsync(2_000)

      expect(getImageJob).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queries the same server task after an ambiguous submission failure', async () => {
    vi.mocked(submitImageJob).mockRejectedValue(new TypeError('Failed to fetch'))
    vi.mocked(getImageJob).mockResolvedValue({
      id: 'task',
      status: 'running',
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      error: null,
      resultUrls: [],
    })

    await submitTask()
    await vi.waitFor(() => expect(getImageJob).toHaveBeenCalled())

    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'running', executionMode: 'server' })
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('keeps an afternoon-tea submit pending until its server task is terminal', async () => {
    let resolveJob!: (job: Awaited<ReturnType<typeof getImageJob>>) => void
    const jobResult = new Promise<Awaited<ReturnType<typeof getImageJob>>>((resolve) => {
      resolveJob = resolve
    })
    vi.mocked(submitImageJob).mockResolvedValue({
      id: 'afternoon-server-task',
      status: 'running',
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      error: null,
      resultUrls: [],
    })
    vi.mocked(getImageJob).mockReturnValue(jobResult)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['poster'], { type: 'image/png' }))))
    await putImage({ id: imageA.id, dataUrl: imageA.dataUrl })
    let settled = false

    const submission = submitAfternoonTeaPosterTask(afternoonTeaOptions(useStore.getState().settings, {
      executionMode: 'server',
    })).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(getImageJob).toHaveBeenCalled())

    expect(settled).toBe(false)
    resolveJob({
      id: 'afternoon-server-task',
      status: 'done',
      createdAt: 1,
      startedAt: 1,
      finishedAt: 2,
      error: null,
      resultUrls: ['/api/job-files/afternoon/output-1.png'],
    })
    const result = await submission

    expect(result.task.status).toBe('done')
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })

  it('does not persist tools mode because the URL is its source of truth', () => {
    useStore.setState({ appMode: 'tools' })

    expect(getPersistedState(useStore.getState())).not.toHaveProperty('appMode')

    useStore.setState({ appMode: 'agent' })
    expect(getPersistedState(useStore.getState())).toHaveProperty('appMode', 'agent')
  })

  it('keeps legacy tools cache on gallery while retaining agent cache restoration', () => {
    const current = useStore.getState()

    expect(mergePersistedState({ appMode: 'tools' }, current).appMode).toBe('gallery')
    expect(mergePersistedState({ appMode: 'agent' }, current).appMode).toBe('agent')
  })
})

describe('agent conversation persistence', () => {
  beforeEach(async () => {
    await clearAgentConversations()
  })

  it('omits agent conversations from localStorage state', () => {
    const conversation = agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一张图',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: 'large-base64-a' },
          { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'large-base64-b', base64: 'large-base64-c', image: 'large-base64-d', data: 'large-base64-e' } },
        ],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一张图', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已生成图片。', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
      ],
    })
    useStore.setState({ agentConversations: [conversation] })

    const persisted = getPersistedState(useStore.getState())
    const serializedPersisted = JSON.stringify(persisted)

    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('large-base64')
    expect(JSON.stringify(useStore.getState().agentConversations)).toContain('large-base64-a')
  })

  it('loads agent conversations from IndexedDB and migrates legacy localStorage conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
    expect(state.activeAgentConversationId).toBe('legacy-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
  })

  it('strips generated image payloads from legacy task raw payloads during startup migration', async () => {
    await putDbTask(task({
      id: 'legacy-task',
      outputImages: ['image-live'],
      rawResponsePayload: JSON.stringify({
        output: [{ type: 'image_generation_call', id: 'image-call-a', result: 'legacy-task-base64' }],
      }),
    }))

    await initStore()

    const storedTasks = await getAllTasks()
    const serializedStoredTasks = JSON.stringify(storedTasks)
    expect(serializedStoredTasks).toContain('image_generation_call')
    expect(serializedStoredTasks).not.toContain('legacy-task-base64')
  })

  it('keeps agent conversations created while initStore is loading', async () => {
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 1, updatedAt: 1 })
    const earlyConversation = agentConversation({ id: 'early-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    const initPromise = initStore()
    useStore.setState({ agentConversations: [legacyConversation, earlyConversation], activeAgentConversationId: earlyConversation.id })
    await initPromise

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
    expect(state.activeAgentConversationId).toBe('early-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
  })

  it('restores active conversation and draft when localStorage no longer stores conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      appMode: 'agent',
      agentConversations: [],
      activeAgentConversationId: storedConversation.id,
      agentInputDrafts: {
        [storedConversation.id]: {
          prompt: '未发送草稿',
          inputImages: [],
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
    })
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation'])
    expect(state.activeAgentConversationId).toBe('stored-conversation')
    expect(state.agentInputDrafts['stored-conversation']?.prompt).toBe('未发送草稿')
    expect(state.prompt).toBe('未发送草稿')
  })

  it('strips generated image payloads when migrating old persisted state', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      agentConversations: [agentConversation({
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          prompt: '画一张图',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'image_generation_call', id: 'image-call-a', result: 'legacy-base64-a' },
            { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'legacy-base64-b', base64: 'legacy-base64-c' } },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
      })],
    })

    const serializedMigrated = JSON.stringify(migrated)
    expect(serializedMigrated).not.toContain('legacy-base64')
    expect(serializedMigrated).toContain('image_generation_call')
  })
})

describe('fal task recovery', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(getFalQueuedImageResult).mockClear()
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      tasks: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('applies transparent post-processing when a fal task recovers', async () => {
    const falTask = task({
      id: 'fal-transparent-task',
      apiProvider: 'fal',
      apiProfileId: 'fal-profile',
      apiProfileName: 'fal',
      apiModel: 'fal-model',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
      transparentOutput: true,
      transparentPrompt: 'transparent:prompt',
      status: 'error',
      error: '连接已断开，等待自动恢复',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      finishedAt: null,
      elapsed: null,
    })
    await putDbTask(falTask)
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-recovered'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })

    await initStore()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-recovered')
    const recovered = useStore.getState().tasks.find((item) => item.id === falTask.id)
    expect(recovered).toMatchObject({
      status: 'done',
      falRecoverable: false,
      transparentOutput: true,
    })
    expect(recovered?.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(recovered!.outputImages[0])
    const originalImage = await getImage(recovered!.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,fal-recovered')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,fal-recovered')
  })

  it('continues an Agent round after all fal image tasks recover', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValue({
      images: ['data:image/png;base64,agent-recovered'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '已完成。',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '已完成。' }] }],
      responseId: 'response-done',
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: conversation.id,
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0]?.rounds[0]?.status !== 'done'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const recoveredTask = useStore.getState().tasks.find((item) => item.id === agentTask.id)
    expect(recoveredTask).toMatchObject({ status: 'done', falRecoverable: false })
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    const agentInputJson = JSON.stringify(vi.mocked(callAgentResponsesApi).mock.calls[0][0].input)
    expect(agentInputJson).toContain('function_call_output')
    expect(agentInputJson).toContain('\\"status\\":\\"done\\"')
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'done', error: null, responseId: 'response-done' })
    expect(round.responseOutput).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call_output', call_id: 'tool-a' }),
    ]))
  })

  it('records recovered Agent tool failures without continuing the Agent round', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockRejectedValueOnce(new Error('quota exceeded'))
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().tasks.find((item) => item.id === agentTask.id)?.falRecoverable !== false; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const failedTask = useStore.getState().tasks.find((item) => item.id === agentTask.id)
    expect(failedTask).toMatchObject({ status: 'error', error: 'quota exceeded', falRecoverable: false })
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'error', error: 'quota exceeded' })
    const toolOutput = round.responseOutput?.find((item) => item.type === 'function_call_output')
    expect(toolOutput).toMatchObject({ call_id: 'tool-a' })
    expect(toolOutput?.output).toContain('"status":"error"')
    expect(toolOutput?.output).toContain('quota exceeded')
  })

  it('does not call Agent again when recovered tasks already reached the tool limit', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'limit-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,agent-recovered-limit'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
        agentMaxToolRounds: 1,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: conversation.id,
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0]?.rounds[0]?.status !== 'done'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'done', error: null })
    expect(useStore.getState().agentConversations[0].messages.find((message) => message.id === 'assistant-a')?.content).toContain('已达到最大工具调用次数（1）')
  })

  it('does not continue a stopped Agent round when a recoverable fal task later completes', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'error',
        error: '已停止生成。',
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已停止生成。', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,agent-recovered-after-stop'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().tasks.find((item) => item.id === agentTask.id)?.falRecoverable !== false; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    expect(useStore.getState().tasks.find((item) => item.id === agentTask.id)).toMatchObject({ status: 'done', falRecoverable: false })
    expect(useStore.getState().agentConversations[0].rounds[0]).toMatchObject({ status: 'error', error: '已停止生成。' })
  })

  it('does not overwrite a stopped Agent task when an in-flight fal recovery completes', async () => {
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: 'fal-profile',
      apiProfileName: 'fal',
      apiModel: 'fal-model',
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    let resolveRecovery: (value: Awaited<ReturnType<typeof getFalQueuedImageResult>>) => void = () => {}
    vi.mocked(getFalQueuedImageResult).mockImplementationOnce(() => new Promise((resolve) => { resolveRecovery = resolve }))
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && vi.mocked(getFalQueuedImageResult).mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    useStore.setState((state) => ({
      agentConversations: state.agentConversations.map((item) => item.id === 'conversation-a'
        ? { ...item, rounds: item.rounds.map((round) => round.id === 'round-a' ? { ...round, status: 'running', error: null } : round) }
        : item),
    }))
    stopAgentResponse('conversation-a')
    resolveRecovery({
      images: ['data:image/png;base64,should-not-write'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
      falRecoverable: false,
      outputImages: [],
    })
  })

  it('clears recoverable Agent image tasks when stopping the Agent round', () => {
    const agentTask = task({
      id: 'agent-fal-task',
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
    })
    useStore.setState({
      tasks: [agentTask],
      activeAgentConversationId: 'conversation-a',
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画一只猫',
          inputImageIds: [],
          outputTaskIds: [agentTask.id],
          status: 'running',
          error: null,
          createdAt: 1,
          finishedAt: null,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
        ],
      })],
      showToast: vi.fn(),
    })

    stopAgentResponse('conversation-a')

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
      falRecoverable: false,
    })
    expect(useStore.getState().agentConversations[0].rounds[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
    })
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toEqual(olderEmpty)
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2_000,
        finishedAt: 2_000,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[state.agentConversations.length - 1]).toMatchObject({ id, createdAt: 3_000, updatedAt: 3_000, messages: [], rounds: [] })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })
})

describe('agent round deletion', () => {
  it('renumbers later rounds and remaps image mentions after deleting a middle round', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          assistantMessageId: 'assistant-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
        { id: 'user-2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
        { id: 'assistant-2', role: 'assistant', content: '完成', roundId: 'round-2', createdAt: 4 },
        { id: 'user-3', role: 'user', content: '参考 @第1轮图1、@第2轮图1、@第3轮图1', roundId: 'round-3', createdAt: 5 },
        { id: 'assistant-3', role: 'assistant', content: '完成', roundId: 'round-3', createdAt: 6 },
      ],
    })

    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)

    expect(deleted.rounds.map((round) => ({ id: round.id, index: round.index, parentRoundId: round.parentRoundId }))).toEqual([
      { id: 'round-1', index: 1, parentRoundId: null },
      { id: 'round-3', index: 2, parentRoundId: 'round-1' },
    ])
    expect(deleted.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-3', 'assistant-3'])
    expect(deleted.messages.find((message) => message.id === 'user-3')?.content).toBe('参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
    expect(deleted.activeRoundId).toBe('round-3')
    expect(deleted.updatedAt).toBe(10)
  })

  it('can remap draft mentions using the old and new active paths after deletion', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [],
    })
    const oldPath = getActiveAgentRounds(conversation)
    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)
    const newPath = getActiveAgentRounds(deleted)

    expect(remapAgentRoundMentionsForPathChange('继续参考 @第1轮图1、@第2轮图1、@第3轮图1', oldPath, newPath))
      .toBe('继续参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
  })

  it('collects agent round and conversation tasks even when some failed tasks are not in outputTaskIds', () => {
    const conversation = agentConversation({
      id: 'conversation-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '第一轮',
        inputImageIds: [],
        outputTaskIds: ['task-success'],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [],
    })
    const tasks = [
      task({ id: 'task-success', agentConversationId: 'conversation-a', agentRoundId: 'round-a', status: 'done', outputImages: ['image-a'] }),
      task({ id: 'task-failed', agentConversationId: 'conversation-a', agentRoundId: 'round-a', status: 'error', error: '失败' }),
      task({ id: 'task-unrelated', agentConversationId: 'other', agentRoundId: 'other-round', status: 'error', error: '失败' }),
    ]

    expect(getAgentRoundTaskIds(conversation.rounds[0], tasks)).toEqual(['task-success', 'task-failed'])
    expect(getAgentConversationTaskIds(conversation, tasks)).toEqual(['task-success', 'task-failed'])
  })
})

describe('data import', () => {
  beforeEach(async () => {
    await clearAfternoonTeaConversations()
    await clearImages()
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      afternoonTeaConversations: [],
      activeAfternoonTeaConversationId: null,
      showToast: vi.fn(),
    })
    await clearAgentConversations()
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入收藏夹 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入收藏夹 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [importedTask],
      favoriteCollections: importedCollections,
      defaultFavoriteCollectionId: importedCollections[1].id,
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [
        agentConversation({ id: 'empty-conversation' }),
        usedConversation,
      ],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['local-conversation', 'imported-conversation'])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('stores imported legacy agent conversations in IndexedDB without localStorage or image payloads', async () => {
    const importedConversation = agentConversation({
      id: 'legacy-imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: { base64: 'imported-legacy-base64' } },
        ],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })

    const imported = await importData(importFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const indexedConversations = await getAllAgentConversations()
    const persisted = getPersistedState(useStore.getState())
    const serializedIndexedConversations = JSON.stringify(indexedConversations)
    const serializedPersisted = JSON.stringify(persisted)

    expect(imported).toBe(true)
    expect(indexedConversations.map((conversation) => conversation.id)).toEqual(['legacy-imported-conversation'])
    expect(serializedIndexedConversations).toContain('image_generation_call')
    expect(serializedIndexedConversations).not.toContain('imported-legacy-base64')
    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('imported-legacy-base64')
  })

  it('imports a complete multipart backup selected in any order', async () => {
    await clearTasks()
    await clearImages()
    const importedTask = task({ id: 'multipart-task', outputImages: ['multipart-image-a', 'multipart-image-b'] })
    const part1 = importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'backup-a', index: 1, total: 2 },
      tasks: [importedTask],
      favoriteCollections: [],
      agentConversations: [],
      imageFiles: { 'multipart-image-a': { path: 'images/image-a.png' } },
    }, { 'images/image-a.png': new Uint8Array([1, 2]) })
    const part2 = importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'backup-a', index: 2, total: 2 },
      tasks: [task({ id: 'multipart-task-2' })],
      imageFiles: { 'multipart-image-b': { path: 'images/image-b.png' } },
    }, { 'images/image-b.png': new Uint8Array([3, 4]) })

    const imported = await importData([part2, part1], { importConfig: false, importTasks: true })

    expect(imported).toBe(true)
    expect((await getAllTasks()).some((item) => item.id === importedTask.id)).toBe(true)
    expect((await getAllTasks()).some((item) => item.id === 'multipart-task-2')).toBe(true)
    expect(await getImage('multipart-image-a')).toMatchObject({ dataUrl: 'data:image/png;base64,AQI=' })
    expect(await getImage('multipart-image-b')).toMatchObject({ dataUrl: 'data:image/png;base64,AwQ=' })
  })

  it('rejects an incomplete multipart backup before importing data', async () => {
    await clearTasks()
    const part1 = importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'backup-a', index: 1, total: 2 },
      tasks: [task({ id: 'incomplete-task' })],
      imageFiles: {},
    })

    const imported = await importData([part1], { importConfig: false, importTasks: true })

    expect(imported).toBe(false)
    expect((await getAllTasks()).some((item) => item.id === 'incomplete-task')).toBe(false)
  })

  it('validates image entries in every part before writing earlier parts', async () => {
    await clearImages()
    const part1 = importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'backup-a', index: 1, total: 2 },
      tasks: [],
      afternoonTeaConversations: [afternoonTeaConversation({ id: 'preflight-tea' })],
      imageFiles: { 'preflight-image-a': { path: 'images/image-a.png' } },
    }, { 'images/image-a.png': new Uint8Array([1, 2]) })
    const part2 = importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'backup-a', index: 2, total: 2 },
      imageFiles: { 'preflight-image-b': { path: 'images/missing.png' } },
    })

    const imported = await importData([part1, part2], { importConfig: false, importTasks: true })

    expect(imported).toBe(false)
    expect(await getImage('preflight-image-a')).toBeUndefined()
    expect(useStore.getState().afternoonTeaConversations).toEqual([])
    expect(await getAllAfternoonTeaConversations()).toEqual([])
  })

  it('imports config with running tasks without requiring image parts', async () => {
    useStore.setState({ tasks: [task({ status: 'running' })] })
    const part1 = importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'config-backup', index: 1, total: 3 },
      settings: DEFAULT_SETTINGS,
      tasks: [],
      imageFiles: { 'unused-image': { path: 'images/missing.png' } },
    })

    const imported = await importData([part1], { importConfig: true, importTasks: false })

    expect(imported).toBe(true)
  })

  it('imports conversation-only data, replaces same ids regardless of timestamp, preserves unrelated records, and persists', async () => {
    const localSameId = afternoonTeaConversation({ id: 'same-id', title: '本地较新', createdAt: 100, updatedAt: 100 })
    const localUnrelated = afternoonTeaConversation({ id: 'local-only', title: '本地保留', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      afternoonTeaConversations: [localSameId, localUnrelated],
      activeAfternoonTeaConversationId: localUnrelated.id,
    })
    await putAfternoonTeaConversation(localSameId)
    await putAfternoonTeaConversation(localUnrelated)
    vi.mocked(replaceAfternoonTeaConversations).mockClear()

    const importedSameId = afternoonTeaConversation({ id: 'same-id', title: '导入较旧但应覆盖', createdAt: 2, updatedAt: 2 })
    const importedFirst = afternoonTeaConversation({ id: 'imported-first', title: '导入首条', createdAt: 3, updatedAt: 3 })
    const imported = await importData(importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      afternoonTeaConversations: [null, { id: '' }, importedSameId, importedFirst],
    } as ExportData), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    const persisted = await getAllAfternoonTeaConversations()
    expect(imported).toBe(true)
    expect(state.afternoonTeaConversations.map((conversation) => conversation.id)).toEqual(['same-id', 'local-only', 'imported-first'])
    expect(state.afternoonTeaConversations.find((conversation) => conversation.id === 'same-id')?.title).toBe('导入较旧但应覆盖')
    expect(state.activeAfternoonTeaConversationId).toBe('local-only')
    expect(persisted).toEqual(state.afternoonTeaConversations)
    expect(replaceAfternoonTeaConversations).toHaveBeenCalled()
    expect(state.showToast).toHaveBeenCalledWith('数据已成功导入', 'success')
  })

  it('restores app-shaped afternoon tea data without applying empty task metadata side effects', async () => {
    await clearTasks()
    const localTask = task({ id: 'local-task' })
    const localAgentConversation = agentConversation({ id: 'local-agent' })
    const localCollection = { id: 'local-collection', name: '本地收藏夹', createdAt: 1, updatedAt: 1 }
    const importedCollection = { id: 'backup-collection', name: '备份收藏夹', createdAt: 2, updatedAt: 2 }
    const imageId = 'app-shaped-tea-source'
    const conversation = afternoonTeaConversation({ id: 'app-shaped-tea', sourceImageId: imageId })
    await putDbTask(localTask)
    useStore.setState({
      tasks: [localTask],
      agentConversations: [localAgentConversation],
      activeAgentConversationId: localAgentConversation.id,
      favoriteCollections: [localCollection],
      defaultFavoriteCollectionId: localCollection.id,
      supportPromptOpen: false,
      supportPromptDismissed: false,
      supportPromptSkippedForImportedData: true,
      showToast: vi.fn(),
    })

    const imported = await importData(importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [],
      favoriteCollections: [importedCollection],
      defaultFavoriteCollectionId: importedCollection.id,
      afternoonTeaConversations: [conversation],
      imageFiles: { [imageId]: { path: 'images/tea-source.png' } },
      thumbnailFiles: {},
    }, { 'images/tea-source.png': new Uint8Array([1, 2]) }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(await getImage(imageId)).toMatchObject({ dataUrl: 'data:image/png;base64,AQI=' })
    expect(state.afternoonTeaConversations).toEqual([conversation])
    expect(state.tasks).toEqual([localTask])
    expect(state.agentConversations).toEqual([localAgentConversation])
    expect(state.activeAgentConversationId).toBe(localAgentConversation.id)
    expect(state.favoriteCollections).toEqual([localCollection])
    expect(state.defaultFavoriteCollectionId).toBe(localCollection.id)
    expect(state.supportPromptOpen).toBe(false)
    expect(state.supportPromptSkippedForImportedData).toBe(true)
    expect(state.showToast).toHaveBeenCalledWith('数据已成功导入', 'success')
  })

  it('imports v3 backups without an afternoon tea field and keeps local conversations', async () => {
    const local = afternoonTeaConversation({ id: 'local-tea' })
    useStore.setState({ afternoonTeaConversations: [local], activeAfternoonTeaConversationId: local.id })
    await putAfternoonTeaConversation(local)

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    expect(imported).toBe(true)
    expect(useStore.getState().afternoonTeaConversations).toEqual([local])
  })

  it('imports afternoon tea metadata and its source image from different multipart files selected out of order', async () => {
    const imageId = 'multipart-tea-source'
    const conversation = afternoonTeaConversation({ id: 'multipart-tea', sourceImageId: imageId })
    const part1 = importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'tea-backup', index: 1, total: 2 },
      tasks: [],
      imageFiles: { [imageId]: { path: 'images/tea-source.png' } },
    }, { 'images/tea-source.png': new Uint8Array([1, 2]) })
    const part2 = importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      backupPart: { id: 'tea-backup', index: 2, total: 2 },
      afternoonTeaConversations: [conversation],
    })

    const imported = await importData([part2, part1], { importConfig: false, importTasks: true })

    expect(imported).toBe(true)
    expect(useStore.getState().afternoonTeaConversations).toEqual([conversation])
    expect(useStore.getState().activeAfternoonTeaConversationId).toBe(conversation.id)
    expect(await getAllAfternoonTeaConversations()).toEqual([conversation])
    expect(await getImage(imageId)).toMatchObject({ dataUrl: 'data:image/png;base64,AQI=' })
  })

  it('waits for the latest queued afternoon tea snapshot without overlapping IndexedDB replacements', async () => {
    const replace = vi.mocked(replaceAfternoonTeaConversations)
    const originalReplace = replace.getMockImplementation()!
    let releaseFirst = () => {}
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    let inFlight = 0
    let maxInFlight = 0
    replace.mockClear()
    replace.mockImplementation(async (conversations) => {
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (calls === 1) await firstBlocked
      await originalReplace(conversations)
      inFlight--
    })

    try {
      const importedConversation = afternoonTeaConversation({ id: 'queued-import', title: '导入标题' })
      let importResolved = false
      const importing = importData(importFile({
        version: 4,
        exportedAt: new Date(0).toISOString(),
        afternoonTeaConversations: [importedConversation],
      }), { importConfig: false, importTasks: true }).then((result) => {
        importResolved = true
        return result
      })
      await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))

      useStore.getState().renameAfternoonTeaConversation(importedConversation.id, '导入后本地修改')
      await Promise.resolve()
      expect(importResolved).toBe(false)
      expect(maxInFlight).toBe(1)

      releaseFirst()
      expect(await importing).toBe(true)
      expect(maxInFlight).toBe(1)
      expect(calls).toBe(2)
      expect((await getAllAfternoonTeaConversations())[0].title).toBe('导入后本地修改')
    } finally {
      releaseFirst()
      replace.mockImplementation(originalReplace)
    }
  })

  it('reports import failure when afternoon tea conversations cannot be persisted', async () => {
    const replace = vi.mocked(replaceAfternoonTeaConversations)
    const originalReplace = replace.getMockImplementation()!
    replace.mockClear()
    replace.mockRejectedValue(new Error('IndexedDB unavailable'))
    vi.useFakeTimers()

    try {
      const imported = await importData(importFile({
        version: 4,
        exportedAt: new Date(0).toISOString(),
        afternoonTeaConversations: [afternoonTeaConversation({ id: 'failed-import' })],
      }), { importConfig: false, importTasks: true })

      expect(imported).toBe(false)
      expect(useStore.getState().showToast).toHaveBeenCalledWith(
        expect.stringContaining('导入失败'),
        'error',
      )
    } finally {
      replace.mockImplementation(originalReplace)
      await vi.advanceTimersByTimeAsync(1_000)
      await Promise.resolve()
      vi.useRealTimers()
    }
  })

  it('exports source-only conversation images even when no task references them', async () => {
    const imageId = 'conversation-source-only-image'
    const conversation = afternoonTeaConversation({ id: 'tea-source-only', sourceImageId: imageId })
    await putImage({ id: imageId, dataUrl: 'data:image/png;base64,AQI=', source: 'upload' })
    useStore.setState({
      tasks: [],
      agentConversations: [],
      afternoonTeaConversations: [conversation],
      showToast: vi.fn(),
    })

    const originalDocument = globalThis.document
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    let exportedBlob: Blob | null = null
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({ click: vi.fn(), remove: vi.fn() })),
    })
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      exportedBlob = blob as Blob
      return 'blob:export'
    })
    URL.revokeObjectURL = vi.fn()

    try {
      await exportData({ exportConfig: false, exportTasks: true })
      expect(exportedBlob).not.toBeNull()
      const parsed = await readExportZip(new Uint8Array(await exportedBlob!.arrayBuffer()))
      expect(parsed.manifest.afternoonTeaConversations).toEqual([conversation])
      expect(Object.keys(parsed.manifest.imageFiles ?? {})).toEqual([imageId])
    } finally {
      vi.unstubAllGlobals()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      if (originalDocument) vi.stubGlobal('document', originalDocument)
    }
  })

})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [
        agentConversation({ id: 'conversation-a' }),
        agentConversation({ id: 'conversation-b' }),
      ],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('restores the agent draft when switching back from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps drafts isolated when switching from agent mode to tools', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    useStore.getState().setAppMode('tools')

    const state = useStore.getState()
    expect(state.appMode).toBe('tools')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
    })
  })

  it('keeps the gallery draft when switching into agent mode and back', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(draftState.prompt)

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = { prompt: 'active', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const staleDraft = { prompt: 'stale', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const recentDraft = { prompt: 'recent', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: recentUpdatedAt }

    const cleaned = cleanStaleAgentInputDrafts({
      'conversation-a': activeDraft,
      'conversation-b': staleDraft,
      'conversation-c': recentDraft,
    }, 'conversation-a', now)

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })

})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画两张图',
          inputImageIds: [],
          outputTaskIds: ['task-deleted', 'task-live'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
            { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
            { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '已生成两张图。', roundId: 'round-a', outputTaskIds: ['task-deleted', 'task-live'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('deleted-call')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
    expect(serializedInput).toContain('input_image')
  })

  it('restores stripped image_generation results from task payloads when building context', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                { type: 'image_generation_call', id: 'deleted-call' },
                { type: 'image_generation_call', id: 'live-call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('hydrates stripped task payload image results from stored images when building context', async () => {
    await putImage({ id: 'image-hydrate', dataUrl: 'data:image/png;base64,hydrated-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [{ type: 'image_generation_call' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-hydrate'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-live'],
              responseOutput: [{ type: 'image_generation_call' }],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('hydrated-live-base64')
  })

  it('restores stripped image results even when legacy tasks lack tool call ids', async () => {
    await putImage({ id: 'image-legacy', dataUrl: 'data:image/png;base64,legacy-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
        { type: 'image_generation_call', result: { base64: 'legacy-live-base64' } },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'legacy-task-live',
        outputImages: ['image-legacy'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: undefined,
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['legacy-task-live'],
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('legacy-live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput.match(/已生成图片。/g)).toHaveLength(1)
  })

  it('restores all stripped batch image results after restart', async () => {
    await putImage({ id: 'image-batch-1', dataUrl: 'data:image/png;base64,batch-base64-1' })
    await putImage({ id: 'image-batch-2', dataUrl: 'data:image/png;base64,batch-base64-2' })
    const batchOnePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-1', result: 'batch-base64-1' }],
    }, null, 2)
    const batchTwoPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-2', result: 'batch-base64-2' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-batch-1',
          outputImages: ['image-batch-1'],
          rawResponsePayload: batchOnePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-1',
          agentBatchCallId: 'batch-fc-1',
        }),
        task({
          id: 'task-batch-2',
          outputImages: ['image-batch-2'],
          rawResponsePayload: batchTwoPayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-2',
          agentBatchCallId: 'batch-fc-1',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-batch-1', 'task-batch-2'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
                { type: 'image_generation_call' },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('batch-base64-1')
    expect(serializedInput).toContain('batch-base64-2')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('batch-call-1')
    expect(serializedInput).not.toContain('batch-call-2')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? { ...round, outputTaskIds: ['task-deleted', 'task-live'], responseOutput: JSON.parse(rawResponsePayload).output }
          : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
    }, null, 2)
    const batchLivePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
    }, null, 2)
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
              ],
            }
          : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })

  it('clears only failed gallery tasks', async () => {
    const failedA = task({ id: 'failed-a', status: 'error', error: '生成失败', outputImages: ['failed-image-a'] })
    const failedB = task({ id: 'failed-b', status: 'error', error: '生成失败', outputImages: ['failed-image-b'] })
    const done = task({ id: 'done-task', status: 'done', outputImages: ['done-image'] })
    const running = task({ id: 'running-task', status: 'running', finishedAt: null, elapsed: null })
    useStore.setState({
      tasks: [failedA, done, failedB, running],
      selectedTaskIds: ['failed-a', 'done-task', 'failed-b'],
      showToast: vi.fn(),
    })

    await clearFailedTasks()

    const state = useStore.getState()
    expect(state.tasks.map((item) => item.id)).toEqual(['done-task', 'running-task'])
    expect(state.selectedTaskIds).toEqual(['done-task'])
    expect(state.showToast).toHaveBeenCalledWith('已删除 2 个任务', 'success')
  })

  it('matches partial failures in failed filters and searches error text', () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a', 'done-image-b'],
      outputErrors: [{ requestIndex: 2, error: 'Failed to fetch' }],
    })

    expect(taskMatchesFilterStatus(partial, 'error')).toBe(true)
    expect(taskMatchesFilterStatus(partial, 'done')).toBe(true)
    expect(taskMatchesSearchQuery(partial, 'failed to fetch')).toBe(true)
  })

  it('clears partial failure markers without deleting successful outputs', async () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a'],
      outputErrors: [{ requestIndex: 1, error: 'Failed to fetch' }],
    })
    useStore.setState({ tasks: [partial], selectedTaskIds: ['partial-task'], showToast: vi.fn() })

    await clearFailedTasks(['partial-task'])

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id: 'partial-task', outputImages: ['done-image-a'], outputErrors: undefined })
    expect(state.selectedTaskIds).toEqual([])
    expect(state.showToast).toHaveBeenCalledWith('已清除 1 条部分失败记录', 'success')
  })

  it('keeps failed tasks created after the cleanup snapshot', async () => {
    const failedAtConfirmOpen = task({ id: 'failed-at-confirm-open', status: 'error', error: '生成失败' })
    const failedAfterConfirmOpen = task({ id: 'failed-after-confirm-open', status: 'error', error: '生成失败' })
    useStore.setState({ tasks: [failedAtConfirmOpen] })
    const failedTaskIds = useStore.getState().tasks
      .filter((item) => item.status === 'error')
      .map((item) => item.id)
    useStore.setState({ tasks: [failedAtConfirmOpen, failedAfterConfirmOpen] })

    await clearFailedTasks(failedTaskIds)

    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['failed-after-confirm-open'])
  })
})

describe('agent built-in image tool failure', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
    streamImages: true,
  })

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(callAgentResponsesApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        streamImages: true,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '画一张图',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [],
      streamPreviews: {},
      streamPreviewSlots: {},
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: null,
        rounds: [],
        messages: [],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('marks a started built-in image task as error when the stream fails', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      throw new Error('image_generation failed')
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().tasks[0]?.status !== 'error'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      outputTaskIds: [failedTask.id],
    })
  })

  it('marks a failed built-in image task as error while the Agent stream continues', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      await opts.onImageToolFailed?.({ toolCallId: 'ig-fail', error: 'safety rejected' })
      opts.onTextDelta?.('图片失败，但回复继续。')
      return {
        text: '图片失败，但回复继续。',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '图片失败，但回复继续。' }] }],
        responseId: 'response-continued',
      }
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'safety rejected',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'done',
      error: null,
      outputTaskIds: [failedTask.id],
    })
    expect(state.agentConversations[0].messages.find((message) => message.role === 'assistant')).toMatchObject({
      content: '图片失败，但回复继续。',
      outputTaskIds: [failedTask.id],
    })
  })
})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-2-b',
        rounds: [
          {
            id: 'round-1',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            prompt: '画基础图',
            inputImageIds: [],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          },
          {
            id: 'round-2-a',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-a',
            assistantMessageId: 'assistant-2-a',
            prompt: '分支 A',
            inputImageIds: [],
            outputTaskIds: ['task-branch-a'],
            status: 'done',
            error: null,
            createdAt: 3,
            finishedAt: 4,
          },
          {
            id: 'round-2-b',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-b',
            assistantMessageId: 'assistant-2-b',
            prompt: '分支 B',
            inputImageIds: [],
            outputTaskIds: ['task-branch-b'],
            status: 'done',
            error: null,
            createdAt: 5,
            finishedAt: 6,
          },
        ],
        messages: [
          { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
          { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
          { id: 'assistant-2-a', role: 'assistant', content: '完成', roundId: 'round-2-a', outputTaskIds: ['task-branch-a'], createdAt: 4 },
          { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
          { id: 'assistant-2-b', role: 'assistant', content: '完成', roundId: 'round-2-b', outputTaskIds: ['task-branch-b'], createdAt: 6 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'next-image',
              prompt: '参考 <ref id="round-2-image-1" /> 生成',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })

  it('resolves batch references to current round input images', async () => {
    useStore.setState({ inputImages: [imageA] })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'variant-image',
              prompt: '参考 <ref id="round-3-reference-1" /> 生成变体',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageA.dataUrl])
    expect(batchArgs.referenceIds).toEqual(['round-3-reference-1'])
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '画一只猫',
      roundId: newRound?.id,
      inputImageIds: [imageA.id],
    }))
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: ['task-a'],
            status: 'error',
            error: '失败',
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '请求失败：失败', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'fal',
      apiProfileName: falProfile.name,
      apiModel: falProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 4, size: '1360x1024', quality: 'high' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「fal 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '找不到 API 配置',
      message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})
