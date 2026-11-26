declare module 'react-router-dom' {
  import React from 'react'

  export const Link: React.ComponentType<{ to: string, children?: React.ReactNode }>
  export const BrowserRouter: React.ComponentType<{ children?: React.ReactNode }>
}
