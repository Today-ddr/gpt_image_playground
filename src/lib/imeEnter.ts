export function isImeEnter(
  event: { key: string; isComposing: boolean; keyCode: number },
  composingRef: boolean,
) {
  return event.key === 'Enter' && (event.isComposing || composingRef || event.keyCode === 229)
}
