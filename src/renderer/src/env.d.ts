import type { SpoonApi } from '../../shared/types'

declare global {
  interface Window {
    spoon: SpoonApi
  }
}

/** A file's text, inlined by Vite (`import art from './x.svg?raw'`). */
declare module '*?raw' {
  const text: string
  export default text
}
