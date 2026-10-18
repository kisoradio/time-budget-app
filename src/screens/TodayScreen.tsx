import { useMemo, useState } from 'react'
import type { AppData } from '../hooks/useAppData'
import { TimelineBar } from '../components/TimelineBar'
import { ActionCard } from '../components/ActionCard'
import { EntryEditor } from '../components/EntryEditor'
import { CategoryEditor, CATEGORY_COLORS } from '../components/CategoryEditor'
import { newId } from '../data/db'
import { BedtimeDialog } from '../components/BedtimeDialog'
import { Sheet } from '../ui/Modal'
import { SwipeRow } from '../ui/SwipeRow'
import { DateTimeField, MinutesField } from '../ui/DateTimeField'
import { useToast } from '../ui/Toast'
import { adjustCategoryTotal, archiveCategory, closeDay, newManualEntry, reopenDay, resetCarryover, startCycle, startMeasuring, stopMeasuring, updateCycleBudgets, updateWakeAt } from '../data/actions'
import { CloseDaySheet } from '../components/CloseDaySheet'
import { hasCarryover, proposeCarryover } from '../domain/carryover'
import type { BudgetMap } from '../domain/types'
import { cycleLabels, deriveCycleRanges, runningEntryOf, splitEntries, summarizeCycle } from '../domain/cycles'
import { formatClock, formatDateTime, formatMinutes, formatMs, msToMinutes, nowIso, toMs } from '../domain/time'
import type { Category, Cycle, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

export function TodayScreen({ data, nowMs, onOpenBudget, onOpenSettings }: { data: AppData; nowMs: number; onOpenBudget: () => void; onOpenSettings: () => void }) {
  const ranges = useMemo(() => deriveCycleRanges(data.cycles), [data.cycles])
  const current = ranges.length ? ranges[ranges.length - 1] : null

  if (!current) return <StartDayScreen data={data} nowMs={nowMs} onOpenSettings={onOpenSettings} />
  return <CycleScreen data={data} cycle={current.cycle} nowMs={nowMs} onOpenBudget={onOpenBudget} onOpenSettings={onOpenSettings} />
}

function Header({ title, subtitle, onTitleTap, onOpenSettings }: { title: string; subtitle?: string; onTitleTap?: () => void; onOpenSettings: () => void }) {
  return (
    <header className="header">
      <button type="button" className="header-title" onClick={onTitleTap} disabled={!onTitleTap}>
        <span className="header-main">{title}{onTitleTap ? ' ▾' : ''}</span>
        {subtitle && <span className="header-sub">{subtitle}</span>}
      </button>
      <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="設定">
        ⚙
      </button>
    </header>
  )
}

/** まだサイクルがない（初回、または記録を消した後） */
function StartDayScreen({ data, nowMs, onOpenSettings }: { data: AppData; nowMs: number; onOpenSettings: () => void }) {
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const start = async (bedAt: string | null) => {
    const r = await startCycle({ wakeAt: nowIso(), bedAt })
    toast.show(r)
    setAsking(false)
  }
  const onStart = () => {
    // 睡眠が動いていなければ就寝時刻を聞く（§5.5）。初めての起動では聞かない。
    if (data.cycles.length === 0 && data.entries.length === 0) void start(null)
    else setAsking(true)
  }
  return (
    <div className="screen">
      <Header title="時間予算" onOpenSettings={onOpenSettings} />
      <div className="start-day">
        <p className="muted">起きたら「今日を開始」を押してください。ここから1日が積み上がっていきます。</p>
        <button type="button" className="btn btn-primary btn-big" onClick={onStart}>
          今日を開始
        </button>
        <p className="muted small">起床時刻は後から修正できます。</p>
      </div>
      {asking && (
        <BedtimeDialog defaultBedAt={data.settings.lastActionAt ?? new Date(nowMs).toISOString()} wakeAt={new Date(nowMs).toISOString()} onSubmit={start} onClose={() => setAsking(false)} />
      )}
    </div>
  )
}

type Menu =
  | { kind: 'card'; category: Category }
  | { kind: 'entries'; category: Category }
  | { kind: 'adjust'; category: Category }
  | { kind: 'budget'; category: Category }
  | { kind: 'category'; category: Category }
  | { kind: 'cycle' }
  | { kind: 'wake' }
  | { kind: 'bedtime' }
  | { kind: 'bedtimeCarry'; bedAt: string | null }
  | { kind: 'closeDay' }
  | { kind: 'addEntry'; category: Category }
  | { kind: 'editEntry'; entry: TimeEntry }
  | { kind: 'newCategory' }

function CycleScreen({ data, cycle, nowMs, onOpenBudget, onOpenSettings }: { data: AppData; cycle: Cycle; nowMs: number; onOpenBudget: () => void; onOpenSettings: () => void }) {
  const toast = useToast()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null)
  const ranges = useMemo(() => deriveCycleRanges(data.cycles), [data.cycles])
  const range = ranges[ranges.length - 1]
  const segments = useMemo(() => splitEntries(data.entries, ranges, nowMs), [data.entries, ranges, nowMs])
  const summary = useMemo(() => summarizeCycle(range, segments, nowMs), [range, segments, nowMs])
  const labels = useMemo(() => cycleLabels(data.cycles), [data.cycles])
  const cards = data.activeCategories.filter((c) => c.id !== SLEEP_CATEGORY_ID)
  const sleep = data.sleepCategory

  const msOf = (id: string) => summary.totalsMs[id] ?? 0

  const onTap = async (category: Category) => {
    const running = runningEntryOf(data.entries, category.id)
    const r = running ? await stopMeasuring(running, category.name) : await startMeasuring(category)
    toast.show(r)
  }
  const onLongPress = async (category: Category) => {
    if (runningEntryOf(data.entries, category.id)) return
    const r = await startMeasuring(category, { concurrent: true })
    toast.show(r)
  }
  const carryRows = () =>
    proposeCarryover(
      data.activeCategories,
      cycle.budgets,
      cycle.carryover,
      Object.fromEntries(Object.entries(summary.totalsMs).map(([k, v]) => [k, msToMinutes(v)])),
    )
  const onCloseDay = async (next: BudgetMap) => {
    const r = await closeDay(cycle, next)
    toast.show(r)
    setMenu(null)
  }
  const onWake = async () => {
    const r = await startCycle({ wakeAt: nowIso() })
    toast.show(r)
  }
  const closed = !!cycle.closedAt
  const sleepRunning = runningEntryOf(data.entries, SLEEP_CATEGORY_ID)
  const onArchive = async (category: Category) => {
    setSwipeOpenId(null)
    const r = await archiveCategory(category)
    toast.show(r)
  }

  return (
    <div className="screen">
      <Header title={labels[cycle.id] ?? ''} subtitle={`起床 ${formatClock(cycle.wakeAt)}`} onTitleTap={() => setMenu({ kind: 'cycle' })} onOpenSettings={onOpenSettings} />
      {closed && (
        <div className="closed-band">
          <div className="closed-text">
            <span className="closed-title">おやすみ中</span>
            <span className="muted small">
              {formatClock(cycle.closedAt!)} から{sleepRunning ? `・睡眠 ${formatMs(nowMs - toMs(sleepRunning.startAt))}` : ''}
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-big" onClick={onWake}>
            起床（今日を開始）
          </button>
          <button
            type="button"
            className="link"
            onClick={async () => {
              const r = await reopenDay(cycle)
              toast.show(r)
            }}
          >
            おやすみを取り消して1日を続ける
          </button>
        </div>
      )}
      <TimelineBar range={range} segments={summary.segments} categories={data.categories} nowMs={nowMs} onTap={onOpenBudget} />
      <div className="cards">
        {cards.map((c) => (
          <SwipeRow key={c.id} open={swipeOpenId === c.id} onOpenChange={(o) => setSwipeOpenId(o ? c.id : swipeOpenId === c.id ? null : swipeOpenId)} onDelete={() => onArchive(c)}>
            <ActionCard
              category={c}
              measuredMs={msOf(c.id)}
              budgetMin={cycle.budgets[c.id] ?? 0}
              carryMin={cycle.carryover?.[c.id] ?? 0}
              running={!!runningEntryOf(data.entries, c.id)}
              onTap={() => onTap(c)}
              onLongPress={() => onLongPress(c)}
              onMenu={() => setMenu({ kind: 'card', category: c })}
            />
          </SwipeRow>
        ))}
        {sleep && (
          <ActionCard
            category={sleep}
            measuredMs={msOf(sleep.id)}
            budgetMin={cycle.budgets[sleep.id] ?? 0}
            running={!!sleepRunning}
            onTap={() => onTap(sleep)}
            onLongPress={() => onLongPress(sleep)}
            onMenu={() => setMenu({ kind: 'card', category: sleep })}
          />
        )}
        <button type="button" className="add-row" onClick={() => setMenu({ kind: 'newCategory' })}>
          ＋ タイマーを追加
        </button>
        {!closed && (
          <button type="button" className="btn btn-big btn-night" onClick={() => setMenu({ kind: 'closeDay' })}>
            おやすみ
          </button>
        )}
      </div>
      <p className="muted small center">カードをタップで開始／停止、長押しで同時計測。左にスライドで削除。寝るときは「おやすみ」で1日を締めます。</p>

      {menu?.kind === 'card' && (
        <Sheet title={menu.category.name} onClose={() => setMenu(null)}>
          <div className="stack">
            <button type="button" className="btn btn-block" onClick={() => setMenu({ kind: 'adjust', category: menu.category })}>
              合計時間を調整
            </button>
            <button type="button" className="btn btn-block" onClick={() => setMenu({ kind: 'budget', category: menu.category })}>
              枠を変更
            </button>
            <button type="button" className="btn btn-block" onClick={() => setMenu({ kind: 'category', category: menu.category })}>
              タイマーの設定
            </button>
            {(cycle.carryover?.[menu.category.id] ?? 0) !== 0 && (
              <button
                type="button"
                className="btn btn-block btn-quiet"
                onClick={async () => {
                  const r = await resetCarryover(cycle, menu.category.id)
                  toast.show(r)
                  setMenu(null)
                }}
              >
                繰り越し（{(cycle.carryover?.[menu.category.id] ?? 0) > 0 ? '+' : '−'}{formatMinutes(Math.abs(cycle.carryover?.[menu.category.id] ?? 0))}）をリセット
              </button>
            )}
          </div>
        </Sheet>
      )}
      {menu?.kind === 'closeDay' && <CloseDaySheet rows={carryRows()} onSubmit={onCloseDay} onClose={() => setMenu(null)} />}
      {menu?.kind === 'adjust' && (
        <AdjustTotalSheet
          category={menu.category}
          currentMs={msOf(menu.category.id)}
          wakeAt={cycle.wakeAt}
          nowMs={nowMs}
          onSave={async (targetMs, moveWakeEarlier) => {
            const r = await adjustCategoryTotal(menu.category, cycle, targetMs, nowMs, { moveWakeEarlier })
            toast.show(r)
            setMenu(null)
          }}
          onDetail={() => setMenu({ kind: 'entries', category: menu.category })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'entries' && (
        <EntryList
          category={menu.category}
          entries={data.entries.filter((e) => e.categoryId === menu.category.id && summary.segments.some((s) => s.entryId === e.id))}
          nowMs={nowMs}
          onEdit={(entry) => setMenu({ kind: 'editEntry', entry })}
          onAdd={() => setMenu({ kind: 'addEntry', category: menu.category })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'editEntry' && <EntryEditor entry={menu.entry} categories={data.categories} nowMs={nowMs} wakeAt={cycle.wakeAt} onClose={() => setMenu(null)} />}
      {menu?.kind === 'addEntry' && (
        <EntryEditor
          entry={newManualEntry(menu.category.id, new Date(nowMs - 3_600_000).toISOString(), new Date(nowMs).toISOString())}
          categories={data.categories}
          isNew
          nowMs={nowMs}
          wakeAt={cycle.wakeAt}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'budget' && (
        <BudgetSheet
          category={menu.category}
          minutes={cycle.budgets[menu.category.id] ?? 0}
          onSave={async (min) => {
            await updateCycleBudgets(cycle, { ...cycle.budgets, [menu.category.id]: min })
            toast.info('今日の枠を変えました')
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'category' && <CategoryEditor category={menu.category} onClose={() => setMenu(null)} />}
      {menu?.kind === 'newCategory' && <CategoryEditor category={newCategoryDraft(cards.length)} isNew onClose={() => setMenu(null)} />}
      {menu?.kind === 'cycle' && (
        <Sheet title={`${labels[cycle.id]} のサイクル`} onClose={() => setMenu(null)}>
          <p className="muted small">
            起床 {formatDateTime(cycle.wakeAt)}・経過 {formatMs(summary.elapsedMs)}・未計測 {formatMs(summary.unmeasuredMs)}
          </p>
          <div className="stack">
            <button type="button" className="btn btn-block btn-primary" onClick={() => setMenu({ kind: 'wake' })}>
              起床時刻を修正
            </button>
            {hasCarryover(cycle.carryover) && (
              <button
                type="button"
                className="btn btn-block"
                onClick={async () => {
                  const r = await resetCarryover(cycle)
                  toast.show(r)
                  setMenu(null)
                }}
              >
                繰り越しをすべてリセット
              </button>
            )}
            <p className="muted small">次の2つは「新しい1日」を始める操作です。枠はテンプレートからコピーし直されます。</p>
            <button type="button" className="btn btn-block" onClick={() => setMenu({ kind: 'bedtime' })}>
              新しい1日を始める（就寝を押し忘れたとき）
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={async () => {
                const r = await startCycle({ wakeAt: nowIso(), manualCut: true })
                toast.show(r)
                setMenu(null)
              }}
            >
              ここで区切る（新しいサイクルを今から始める）
            </button>
          </div>
        </Sheet>
      )}
      {menu?.kind === 'bedtime' && (
        <BedtimeDialog
          defaultBedAt={data.settings.lastActionAt ?? new Date(nowMs).toISOString()}
          wakeAt={new Date(nowMs).toISOString()}
          onSubmit={(bedAt) => setMenu({ kind: 'bedtimeCarry', bedAt })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'bedtimeCarry' && (
        <CloseDaySheet
          rows={carryRows()}
          title="昨日のまとめ"
          primaryLabel="新しい1日を始める"
          onSubmit={async (carry) => {
            const r = await startCycle({ wakeAt: nowIso(), bedAt: menu.bedAt, carryover: carry })
            toast.show(r)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'wake' && (
        <WakeSheet
          cycle={cycle}
          nowMs={nowMs}
          onSave={async (iso) => {
            const r = await updateWakeAt(cycle, iso)
            toast.show(r)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

export function WakeSheet({ cycle, nowMs, onSave, onClose }: { cycle: Cycle; nowMs: number; onSave: (iso: string) => void; onClose: () => void }) {
  const [wakeAt, setWakeAt] = useState(cycle.wakeAt)
  const invalid = toMs(wakeAt) > nowMs
  return (
    <Sheet title="起床時刻を修正" onClose={onClose}>
      <p className="muted small">修正すると、境界をまたぐ計測記録の所属は自動で付け替わります。</p>
      <DateTimeField label="起床時刻" value={wakeAt} onChange={(iso) => iso && setWakeAt(iso)} />
      {invalid && <p className="error">未来の時刻にはできません</p>}
      <div className="sheet-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(wakeAt)} disabled={invalid}>
          保存
        </button>
      </div>
    </Sheet>
  )
}

function AdjustTotalSheet({
  category,
  currentMs,
  wakeAt,
  nowMs,
  onSave,
  onDetail,
  onClose,
}: {
  category: Category
  currentMs: number
  wakeAt: string
  nowMs: number
  onSave: (ms: number, moveWakeEarlier: boolean) => void
  onDetail: () => void
  onClose: () => void
}) {
  const currentMin = Math.round(currentMs / 60_000)
  const [value, setValue] = useState(currentMin)
  // 起床から今までの時間より多くは、起床を早めないと今日に入らない
  const capacityMin = Math.max(0, Math.floor((nowMs - toMs(wakeAt)) / 60_000))
  const needsEarlierWake = value > capacityMin
  return (
    <Sheet title={`${category.name}の今日の合計`} onClose={onClose}>
      <p className="muted small">押し忘れなどで実際と違うときに、合計を合わせます。増やすと直近の記録が伸び、減らすと直近の記録から縮みます。</p>
      <MinutesField value={value} onChange={setValue} step={10} />
      <p className="muted small">
        今の合計 {formatMinutes(currentMin)}
        {value !== currentMin && ` → ${formatMinutes(value)}（${value > currentMin ? '+' : '−'}${formatMinutes(Math.abs(value - currentMin))}）`}
      </p>
      {needsEarlierWake && (
        <p className="notice">
          起床（{formatClock(wakeAt)}）から今までは {formatMinutes(capacityMin)} なので、今日に入るのはそこまでです。保存すると、足りない {formatMinutes(value - capacityMin)} の分だけ起床時刻を早めて（{formatClock(new Date(toMs(wakeAt) - (value - capacityMin) * 60_000).toISOString())}）入れます。
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-quiet" onClick={onDetail}>
          記録ごとに修正
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(value * 60_000, needsEarlierWake)} disabled={value === currentMin}>
          {needsEarlierWake ? '起床を早めて保存' : '保存'}
        </button>
      </div>
    </Sheet>
  )
}

function BudgetSheet({ category, minutes, onSave, onClose }: { category: Category; minutes: number; onSave: (min: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(minutes)
  return (
    <Sheet title={`${category.name}の枠（今日）`} onClose={onClose}>
      <MinutesField value={value} onChange={setValue} />
      <p className="muted small">次回からの枠は「配分」タブのテンプレートで変えられます。</p>
      <div className="sheet-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(value)}>
          保存
        </button>
      </div>
    </Sheet>
  )
}

export function EntryList({
  category,
  entries,
  nowMs,
  onEdit,
  onAdd,
  onClose,
}: {
  category: Category
  entries: TimeEntry[]
  nowMs: number
  onEdit: (entry: TimeEntry) => void
  onAdd: () => void
  onClose: () => void
}) {
  const sorted = [...entries].sort((a, b) => toMs(b.startAt) - toMs(a.startAt))
  return (
    <Sheet title={`${category.name}の記録`} onClose={onClose}>
      {sorted.length === 0 && <p className="muted">このサイクルの記録はありません。</p>}
      <ul className="entry-list">
        {sorted.map((e) => (
          <li key={e.id}>
            <button type="button" className="entry-row" onClick={() => onEdit(e)}>
              <span>
                {formatClock(e.startAt)} – {e.endAt ? formatClock(e.endAt) : '計測中'}
              </span>
              <span className="muted">{formatMs((e.endAt ? toMs(e.endAt) : nowMs) - toMs(e.startAt))}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onAdd}>
          記録を追加
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Sheet>
  )
}

/** 新しいタイマー（カテゴリー）の下書き。色は順番に割り当てる */
export function newCategoryDraft(count: number): Category {
  return {
    id: newId(),
    name: '',
    color: CATEGORY_COLORS[count % CATEGORY_COLORS.length],
    order: count,
    mode: 'stopwatch',
    protect: false,
    archived: false,
    updatedAt: '',
  }
}
