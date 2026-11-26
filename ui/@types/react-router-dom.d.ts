declare module 'react-router-dom' {
  import { ComponentType, ReactNode } from 'react'

  export const Link: ComponentType<{ to: string, children?: ReactNode }>
}
