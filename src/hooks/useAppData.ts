import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, DEFAULT_SETTINGS, TEMPLATE_ID } from '../data/db'
import type { BudgetTemplate, Category, Cycle, Settings, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

export interface AppData {
  loaded: boolean
  categories: Category[]
  /** アーカイブ済みを除き、並び順どおり。睡眠は最後。 */
  activeCategories: Category[]
  sleepCategory: Category | undefined
  cycles: Cycle[]
  entries: TimeEntry[]
  template: BudgetTemplate | undefined
  settings: Settings
}

export function useAppData(): AppData {
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const cycles = useLiveQuery(() => db.cycles.toArray(), [])
  const entries = useLiveQuery(() => db.entries.toArray(), [])
  const template = useLiveQuery(() => db.templates.get(TEMPLATE_ID), [])
  const settings = useLiveQuery(() => db.settings.get('settings'), [])

  return useMemo(() => {
    const cats = categories ?? []
    const active = cats
      .filter((c) => !c.archived)
      .sort((a, b) => (a.id === SLEEP_CATEGORY_ID ? 1 : b.id === SLEEP_CATEGORY_ID ? -1 : a.order - b.order))
    return {
      loaded: categories !== undefined && cycles !== undefined && entries !== undefined && settings !== undefined,
      categories: cats,
      activeCategories: active,
      sleepCategory: cats.find((c) => c.id === SLEEP_CATEGORY_ID),
      cycles: cycles ?? [],
      entries: entries ?? [],
      template: template ?? undefined,
      settings: settings ?? DEFAULT_SETTINGS,
    }
  }, [categories, cycles, entries, template, settings])
}
