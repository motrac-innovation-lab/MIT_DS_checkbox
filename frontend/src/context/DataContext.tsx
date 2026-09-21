import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { DataProvider } from '../lib/dataProvider'
import { ApiDataProvider } from '../lib/apiDataProvider'
import { MockDataProvider } from '../lib/mockDataProvider'

// Bedraadt de datalaag op de React-boom (patroon van mit-salessupport). De
// keuze tussen echte backend en mock is een build-time env-var, zodat de
// productiebundel de mock nooit per ongeluk kiest:
//   VITE_DATA_BACKEND=mock  → MockDataProvider (UI-werk zonder backend)
//   anders                  → ApiDataProvider op lib/api.ts
// Hangt binnen de ingelogde shell (App.tsx), niet in main.tsx: de
// provider-volgorde daar is beschermde fleet-basis.
const DataContext = createContext<DataProvider | null>(null)

export function DataProviderContext({ children }: { children: ReactNode }) {
  const provider = useMemo<DataProvider>(
    () => (import.meta.env.VITE_DATA_BACKEND === 'mock' ? new MockDataProvider() : new ApiDataProvider()),
    [],
  )
  return <DataContext.Provider value={provider}>{children}</DataContext.Provider>
}

export function useData(): DataProvider {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData moet binnen <DataProviderContext> gebruikt worden')
  return ctx
}
