import { useMemo, useRef, useState } from 'react'
import type { AppData } from '../hooks/useAppData'
import { EntryEditor } from '../components/EntryEditor'
import { WakeSheet } from './TodayScreen'
import { Sheet } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { newManualEntry, saveSettings, updateWakeAt } from '../data/actions'
import { backupFileName, clearAllData, exportBackup, importBackupOverwrite, parseBackup } from '../data/backup'
import { cycleLabels, deriveCycleRanges, splitEntries, summarizeCycle, type CycleRange } from '../domain/cycles'
import { formatClock, formatDateTime, formatMinutes, formatMs, msToMinutes, nowIso, toMs } from '../domain/time'
import type { TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

const BACKUP_REMIND_DAYS = 7

/** 記録タブ（§12） */
export function RecordsScreen({ data, nowMs }: { data: AppData; nowMs: number }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const ranges = useMemo(() => deriveCycleRanges(data.cycles), [data.cycles])
  const segments = useMemo(() => splitEntries(data.entries, ranges, nowMs), [data.entries, ranges, nowMs])
  const labels = useMemo(() => cycleLabels(data.cycles), [data.cycles])
  const open = ranges.find((r) => r.cycle.id === openId)

  if (open) {
    return <CycleDetail data={data} range={open} label={labels[open.cycle.id]} segments={segments} nowMs={nowMs} onBack={() => setOpenId(null)} />
  }

  const list = [...ranges].reverse()
  const lastBackup = data.settings.lastBackupAt ? toMs(data.settings.lastBackupAt) : null
  const needBackup = data.entries.length > 0 && (lastBackup === null || nowMs - lastBackup > BACKUP_REMIND_DAYS * 86_400_000)

  return (
    <div className="screen">
      <header className="header">
        <span className="header-title">
          <span className="header-main">記録</span>
        </span>
      </header>
      {needBackup && (
        <p className="notice">
          {lastBackup === null ? 'まだバックアップがありません。' : `最後のバックアップから ${Math.floor((nowMs - lastBackup) / 86_400_000)} 日たちました。`}
          下の「JSONを書き出す」で保存できます。
        </p>
      )}
      {list.length === 0 && <p className="muted center">まだ記録がありません。</p>}
      <ul className="cycle-list">
        {list.map((r) => {
          const s = summarizeCycle(r, segments, nowMs)
          return (
            <li key={r.cycle.id}>
              <button type="button" className="cycle-row" onClick={() => setOpenId(r.cycle.id)}>
                <span className="cycle-label">
                  {labels[r.cycle.id]}
                  {r.endMs === null && <span className="tag">進行中</span>}
                  {r.cycle.manualCut && <span className="tag muted">手動で区切り</span>}
                </span>
                <span className="muted small">
                  起床 {formatClock(r.cycle.wakeAt)}・長さ {formatMs(s.elapsedMs)}・睡眠 {formatMs(s.totalsMs[SLEEP_CATEGORY_ID] ?? 0)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <BackupSection data={data} />
    </div>
  )
}

function CycleDetail({
  data,
  range,
  label,
  segments,
  nowMs,
  onBack,
}: {
  data: AppData
  range: CycleRange
  label: string
  segments: ReturnType<typeof splitEntries>
  nowMs: number
  onBack: () => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const [editingWake, setEditingWake] = useState(false)
  const summary = summarizeCycle(range, segments, nowMs)
  const entryIds = new Set(summary.segments.map((s) => s.entryId))
  const entries = data.entries.filter((e) => entryIds.has(e.id)).sort((a, b) => toMs(a.startAt) - toMs(b.startAt))
  const catOf = (id: string) => data.categories.find((c) => c.id === id)
  const rows = data.categories
    .filter((c) => !c.archived || (summary.totalsMs[c.id] ?? 0) > 0 || (range.cycle.budgets[c.id] ?? 0) > 0)
    .sort((a, b) => (a.id === SLEEP_CATEGORY_ID ? 1 : b.id === SLEEP_CATEGORY_ID ? -1 : a.order - b.order))

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
          ‹
        </button>
        <span className="header-title">
          <span className="header-main">{label}</span>
          <span className="header-sub">
            起床 {formatDateTime(range.cycle.wakeAt)}
            {range.endMs !== null && ` 〜 ${formatDateTime(new Date(range.endMs).toISOString())}`}
          </span>
        </span>
        <button type="button" className="link" onClick={() => setEditingWake(true)}>
          起床修正
        </button>
      </header>
      <p className="muted small center">
        長さ {formatMs(summary.elapsedMs)}・計測 {formatMs(summary.measuredMs)}（重複除外）・未計測 {formatMs(summary.unmeasuredMs)}
      </p>
      <table className="summary-table">
        <thead>
          <tr>
            <th>カテゴリー</th>
            <th>予算</th>
            <th>実績</th>
            <th>差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const budget = range.cycle.budgets[c.id] ?? 0
            const actual = msToMinutes(summary.totalsMs[c.id] ?? 0)
            const diff = actual - budget
            return (
              <tr key={c.id}>
                <td>
                  <span className="card-dot" style={{ background: c.color }} />
                  {c.name}
                </td>
                <td>{budget > 0 ? formatMinutes(budget) : '—'}</td>
                <td>{formatMinutes(actual)}</td>
                <td className={diff > 0 && c.mode === 'stopwatch' ? 'positive' : 'muted'}>{budget > 0 || actual > 0 ? (diff >= 0 ? `+${formatMinutes(diff)}` : formatMinutes(diff)) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <h3 className="section-title">計測記録</h3>
      {entries.length === 0 && <p className="muted center">記録はありません。</p>}
      <ul className="entry-list">
        {entries.map((e) => {
          const c = catOf(e.categoryId)
          const crosses = segments.filter((s) => s.entryId === e.id).length > 1
          return (
            <li key={e.id}>
              <button type="button" className="entry-row" onClick={() => setEditing({ entry: e, isNew: false })}>
                <span>
                  <span className="card-dot" style={{ background: c?.color ?? '#999' }} />
                  {c?.name ?? '不明'}
                  <span className="muted small">
                    {' '}
                    {formatDateTime(e.startAt)} – {e.endAt ? formatClock(e.endAt) : '計測中'}
                    {crosses ? '（境界をまたぐ）' : ''}
                  </span>
                </span>
                <span className="muted">{formatMs((e.endAt ? toMs(e.endAt) : nowMs) - toMs(e.startAt))}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="sheet-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const first = data.activeCategories.find((c) => c.id !== SLEEP_CATEGORY_ID) ?? data.activeCategories[0]
            const end = Math.min(nowMs, range.endMs ?? nowMs)
            setEditing({ entry: newManualEntry(first?.id ?? SLEEP_CATEGORY_ID, new Date(end - 3_600_000).toISOString(), new Date(end).toISOString()), isNew: true })
          }}
        >
          記録を追加
        </button>
      </div>
      {editing && <EntryEditor entry={editing.entry} isNew={editing.isNew} categories={data.categories} nowMs={nowMs} onClose={() => setEditing(null)} />}
      {editingWake && (
        <WakeSheet
          cycle={range.cycle}
          nowMs={nowMs}
          onSave={async (iso) => {
            const r = await updateWakeAt(range.cycle, iso)
            toast.show(r)
            setEditingWake(false)
          }}
          onClose={() => setEditingWake(false)}
        />
      )}
    </div>
  )
}

function BackupSection({ data }: { data: AppData }) {
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ text: string; counts: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  const doExport = async () => {
    setBusy(true)
    try {
      const backup = await exportBackup()
      const text = JSON.stringify(backup, null, 2)
      const name = backupFileName(backup.exportedAt)
      const file = new File([text], name, { type: 'application/json' })
      let shared = false
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name })
          shared = true
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            setBusy(false)
            return
          }
        }
      }
      if (!shared) {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      await saveSettings({ lastBackupAt: nowIso() })
      toast.info('JSONを書き出しました')
    } catch (e) {
      console.error(e)
      toast.info('書き出せませんでした')
    } finally {
      setBusy(false)
    }
  }

  const onPick = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const b = parseBackup(text)
      setPending({ text, counts: `サイクル ${b.cycles.length} 件、記録 ${b.entries.length} 件、カテゴリー ${b.categories.length} 件` })
    } catch (e) {
      toast.info((e as Error).message)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const doImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await importBackupOverwrite(parseBackup(pending.text))
      toast.info('読み込みました')
      setPending(null)
    } catch (e) {
      toast.info((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="backup">
      <h3 className="section-title">バックアップ</h3>
      <p className="muted small">
        {data.settings.lastBackupAt ? `最後の書き出し: ${formatDateTime(data.settings.lastBackupAt)}` : 'まだ書き出していません'}
      </p>
      <div className="stack">
        <button type="button" className="btn btn-block" onClick={doExport} disabled={busy}>
          JSONを書き出す
        </button>
        <button type="button" className="btn btn-block" onClick={() => fileInput.current?.click()} disabled={busy}>
          JSONを読み込む（上書き）
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        <button type="button" className="btn btn-block btn-quiet" onClick={() => setConfirmClear(true)} disabled={busy}>
          すべての記録を消去
        </button>
      </div>
      {pending && (
        <Sheet title="読み込んで上書きしますか" onClose={() => setPending(null)}>
          <p>
            ファイルの内容：{pending.counts}。
            <br />
            今の記録はすべて置き換わります。取り消せないので、先に書き出しておくと安心です。
          </p>
          <div className="sheet-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setPending(null)}>
              やめる
            </button>
            <button type="button" className="btn btn-danger" onClick={doImport} disabled={busy}>
              上書きして読み込む
            </button>
          </div>
        </Sheet>
      )}
      {confirmClear && (
        <Sheet title="すべての記録を消去しますか" onClose={() => setConfirmClear(false)}>
          <p>サイクル・計測記録・カテゴリー・予算がすべて消え、初期状態に戻ります。取り消せません。</p>
          <div className="sheet-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
              やめる
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                await clearAllData()
                setConfirmClear(false)
                toast.info('消去しました')
              }}
            >
              消去する
            </button>
          </div>
        </Sheet>
      )}
    </section>
  )
}
