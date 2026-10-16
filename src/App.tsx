import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAppData } from './hooks/useAppData'
import { useNow, useOnForeground } from './hooks/useNow'
import { ToastProvider } from './ui/Toast'
import { TodayScreen } from './screens/TodayScreen'
import { BudgetScreen } from './screens/BudgetScreen'
import { RecordsScreen } from './screens/RecordsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ForgotDialog } from './components/ForgotDialog'
import { ensureSeeded, requestPersistentStorage } from './data/db'
import { currentCycle, detectForgotten } from './domain/cycles'

type Tab = 'today' | 'budget' | 'records'

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const [ready, setReady] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const data = useAppData()
  const nowMs = useNow(1000)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureSeeded()
      const p = await requestPersistentStorage()
      if (!cancelled) {
        setPersisted(p)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 止め忘れの検知（§6.5）：開いたとき・前面に戻ったときに確認する
  const [checkAt, setCheckAt] = useState(() => Date.now())
  const snoozed = useRef<Set<string>>(new Set())
  const recheck = useCallback(() => setCheckAt(Date.now()), [])
  useOnForeground(recheck)
  const forgotten = useMemo(() => {
    if (!ready || !data.loaded) return null
    const hits = detectForgotten(
      data.entries,
      data.categories,
      { normalMinutes: data.settings.forgotThresholdMinutes, sleepMinutes: data.settings.sleepForgotThresholdMinutes },
      checkAt,
    ).filter((h) => !snoozed.current.has(h.entry.id))
    return hits[0] ?? null
    // 閾値の判定は checkAt（開いた・前面に戻った時刻）で行い、表示中に突然出ないようにする
  }, [ready, data.loaded, data.entries, data.categories, data.settings, checkAt])

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // 1時間ごとに更新を確認する
      if (registration) setInterval(() => registration.update(), 60 * 60 * 1000)
    },
  })

  if (!ready || !data.loaded) {
    return <main className="app loading">読み込み中…</main>
  }

  return (
    <main className="app">
      {needRefresh[0] && (
        <div className="update-banner" role="status">
          <span>新しいバージョンがあります</span>
          <button type="button" className="btn btn-small btn-primary" onClick={() => updateServiceWorker(true)}>
            更新
          </button>
        </div>
      )}
      <div className="content">
        {settingsOpen ? (
          <SettingsScreen data={data} persisted={persisted} onBack={() => setSettingsOpen(false)} />
        ) : tab === 'today' ? (
          <TodayScreen data={data} nowMs={nowMs} onOpenBudget={() => setTab('budget')} onOpenSettings={() => setSettingsOpen(true)} />
        ) : tab === 'budget' ? (
          <BudgetScreen data={data} />
        ) : (
          <RecordsScreen data={data} nowMs={nowMs} />
        )}
      </div>
      {!settingsOpen && (
        <nav className="tabbar" aria-label="メイン">
          <button type="button" className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
            <span className="tab-icon">◉</span>今日
          </button>
          <button type="button" className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>
            <span className="tab-icon">◔</span>配分
          </button>
          <button type="button" className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>
            <span className="tab-icon">≡</span>記録
          </button>
        </nav>
      )}
      {forgotten && (
        <ForgotDialog
          entry={forgotten.entry}
          category={forgotten.category}
          elapsedMs={forgotten.elapsedMs}
          nowMs={nowMs}
          dayClosed={!!currentCycle(data.cycles)?.closedAt}
          onDone={recheck}
          onKeep={() => {
            snoozed.current.add(forgotten.entry.id)
            recheck()
          }}
        />
      )}
    </main>
  )
}
