import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { DateTimeField } from '../ui/DateTimeField'
import { deleteEntry, upsertEntry } from '../data/actions'
import { useToast } from '../ui/Toast'
import { formatMs, toMs } from '../domain/time'
import type { Category, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

/** 計測記録の修正・削除・手動追加（§6.6） */
export function EntryEditor({
  entry,
  categories,
  isNew,
  nowMs,
  onClose,
}: {
  entry: TimeEntry
  categories: Category[]
  isNew?: boolean
  nowMs: number
  onClose: () => void
}) {
  const toast = useToast()
  const [draft, setDraft] = useState<TimeEntry>(entry)
  const [error, setError] = useState<string | null>(null)
  const startMs = toMs(draft.startAt)
  const endMs = draft.endAt ? toMs(draft.endAt) : nowMs
  const durationMs = endMs - startMs
  const runningAllowed = isNew || entry.endAt === null

  const save = async () => {
    if (durationMs < 0) {
      setError('終了時刻が開始時刻より前になっています')
      return
    }
    if (draft.endAt === null && startMs > nowMs) {
      setError('開始時刻が未来になっています')
      return
    }
    const kind = draft.categoryId === SLEEP_CATEGORY_ID ? 'sleep' : draft.kind === 'sleep' ? 'manual' : draft.kind
    const r = await upsertEntry({ ...draft, kind }, )
    toast.show(r)
    onClose()
  }

  const remove = async () => {
    const r = await deleteEntry(entry)
    toast.show(r)
    onClose()
  }

  return (
    <Sheet title={isNew ? '記録を追加' : '記録を修正'} onClose={onClose}>
      <label className="field">
        <span className="field-label">カテゴリー</span>
        <select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.archived ? '（アーカイブ済み）' : ''}
            </option>
          ))}
        </select>
      </label>
      <DateTimeField label="開始" value={draft.startAt} onChange={(iso) => iso && setDraft({ ...draft, startAt: iso })} />
      {runningAllowed && (
        <label className="field field-inline">
          <input type="checkbox" checked={draft.endAt === null} onChange={(e) => setDraft({ ...draft, endAt: e.target.checked ? null : new Date(nowMs).toISOString() })} />
          <span>計測中（終了していない）</span>
        </label>
      )}
      {draft.endAt !== null && <DateTimeField label="終了" value={draft.endAt} onChange={(iso) => iso && setDraft({ ...draft, endAt: iso })} />}
      <p className="muted">長さ {durationMs >= 0 ? formatMs(durationMs) : '—'}</p>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {!isNew && (
          <button type="button" className="btn btn-danger" onClick={remove}>
            削除
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          保存
        </button>
      </div>
    </Sheet>
  )
}
