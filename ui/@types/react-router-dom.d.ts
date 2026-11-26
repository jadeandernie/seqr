declare module 'react-router-dom' {
  import * as React from 'react'

  export interface RouterLocation {
    pathname: string
    search: string
  }

  export interface RouterHistory {
    location: RouterLocation
    push: (path: string) => void
    replace: (path: string) => void
  }

  export interface RouteComponentProps<P = Record<string, string | undefined>> {
    match: { params: P, url: string }
    history: RouterHistory
    location: RouterLocation
  }

  export const Link: React.ComponentType<{ to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>
  export const Redirect: React.ComponentType<{ to: string }>
  export const Route: React.ComponentType<{
    path?: string
    component?: React.ComponentType<any> // eslint-disable-line @typescript-eslint/no-explicit-any
    render?: (props: RouteComponentProps) => React.ReactNode
  }>
  export const Router: React.ComponentType<{ history: RouterHistory }>
  export const MemoryRouter: React.ComponentType<{ initialEntries?: string[] }>
}
