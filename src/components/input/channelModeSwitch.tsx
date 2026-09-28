import type { ImageGenerationChannelMode } from '../../types'

const OPTIONS: Array<{ value: ImageGenerationChannelMode; label: string }> = [
  { value: 'single', label: '单渠道' },
  { value: 'multi', label: '多渠道' },
]

export default function ChannelModeSwitch({
  mode,
  detail,
  disabled = false,
  onChange,
}: {
  mode: ImageGenerationChannelMode
  detail: string
  disabled?: boolean
  onChange: (mode: ImageGenerationChannelMode) => void
}) {
  const itemClass = (active: boolean) =>
    `rounded-lg px-2 py-1 text-xs leading-4 transition-colors ${
      active
        ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/10 dark:text-white'
        : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
    } disabled:cursor-not-allowed`

  return (
    <div
      role="group"
      aria-label="生成渠道"
      title={detail}
      className={`flex shrink-0 items-center gap-0.5 rounded-xl border border-gray-200/60 bg-gray-100/70 p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04] ${disabled ? 'opacity-60' : ''}`}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          disabled={disabled}
          onClick={() => {
            if (disabled || option.value === mode) return
            onChange(option.value)
          }}
          className={itemClass(mode === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
