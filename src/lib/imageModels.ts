import type { ApiProfile } from '../types'

/** Responses 模式看图像工具模型，其他模式看配置里的生图模型。留空表示请求不带工具模型 ID。 */
export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

export function isGptImage25Model(model: string) {
  return model.trim().toLowerCase().includes('gpt-image-2.5')
}
