/**
 * 工具页窄屏外壳，对齐画廊移动端：
 * 主操作是离边的磨砂圆角浮层，lg 起回到进度条右侧的文档流。
 */
export const TOOLS_MOBILE_ACTION_DOCK_CLASS = [
  'fixed z-30',
  'max-lg:bottom-[max(1rem,env(safe-area-inset-bottom))]',
  'max-lg:left-[max(0.75rem,env(safe-area-inset-left))]',
  'max-lg:right-[max(0.75rem,env(safe-area-inset-right))]',
  'max-lg:rounded-2xl max-lg:border max-lg:border-white/60 max-lg:bg-white/75 max-lg:p-3',
  'max-lg:shadow-[0_8px_30px_rgb(0,0,0,0.08)] max-lg:ring-1 max-lg:ring-black/5 max-lg:backdrop-blur-2xl',
  'dark:max-lg:border-white/[0.08] dark:max-lg:bg-gray-900/80',
  'dark:max-lg:shadow-[0_8px_30px_rgb(0,0,0,0.35)] dark:max-lg:ring-white/10',
  'lg:static lg:col-start-2 lg:row-start-1 lg:mx-0 lg:mb-4 lg:mt-0 lg:flex lg:justify-end',
  'lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0 lg:backdrop-blur-none dark:lg:bg-transparent',
].join(' ')

/** 窄屏主按钮：对齐画廊「生成图像」。不可用时用灰底深字，避免淡蓝底上的白字看不清。 */
export const toolsMobilePrimaryButtonClass = [
  'min-h-12 w-full touch-manipulation rounded-xl bg-blue-500 px-4 text-sm font-medium text-white shadow-sm',
  'hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.98]',
  'disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:opacity-100 disabled:shadow-none disabled:hover:bg-gray-200',
  'lg:w-auto lg:min-w-56 lg:rounded-md lg:bg-blue-600 lg:text-base lg:font-semibold lg:shadow-none lg:hover:bg-blue-700',
  'lg:disabled:bg-gray-200 lg:disabled:text-gray-500 lg:disabled:shadow-none lg:disabled:hover:bg-gray-200',
  'dark:disabled:bg-white/10 dark:disabled:text-gray-400 dark:disabled:hover:bg-white/10',
  'dark:lg:disabled:bg-white/10 dark:lg:disabled:text-gray-400',
].join(' ')

/** 画廊搜索框 / 输入框的圆角、描边和焦点环。sm 起回到桌面表单。 */
export const toolsMobileFieldClass = [
  'w-full rounded-2xl border border-gray-200/80 bg-white text-gray-900 shadow-sm outline-none',
  'transition-[border-color,box-shadow] placeholder:text-gray-400',
  'focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30',
  'disabled:opacity-60',
  'dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:placeholder:text-gray-500',
  'sm:rounded-md sm:border-gray-200 sm:px-3 sm:shadow-none sm:focus:border-blue-400 sm:focus:ring-blue-100',
  'dark:sm:border-white/[0.1] dark:sm:focus:ring-blue-500/10',
].join(' ')
