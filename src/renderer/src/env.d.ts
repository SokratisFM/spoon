import type { SpoonApi } from '../../shared/types'

declare global {
  interface Window {
    spoon: SpoonApi
  }
}
