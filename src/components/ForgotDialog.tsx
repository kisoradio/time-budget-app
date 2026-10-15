import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { DateTimeField } from '../ui/DateTimeField'
import { stopMeasuring } from '../data/actions'
import { useToast } from '../ui/Toast'
import { formatMs, toMs } from '../domain/time'
import type { Category, TimeEntry } from '../domain/types'

/** 止め忘れの検知（§6.5）：「今」「時刻を指定」「そのまま続ける」 */
export function ForgotDialog({
  entry,
  category,
  elapsedMs,
  nowMs,
  onDone,
  onKeep,
}: {
  entry: TimeEntry
  category: Category | undefined
  elapsedMs: number
  nowMs: number
  onDone: () => void
  onKeep: () => void
}) {
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const [at, setAt] = useState<string>(new Date(nowMs).toISOString())
  const name = category?.name ?? '計測'

  const stopAt = async (iso: string) => {
    if (toMs(iso) < toMs(entry.startAt)) return
    const r = await stopMeasuring(entry, name, iso)
    toast.show(r)
    onDone()
  }

  return (
    <Sheet title="止め忘れていませんか" onClose={onKeep}>
      <p>
        {name}が {formatMs(elapsedMs)} 動いています。いつ終わりましたか？
      </p>
      {picking ? (
        <>
          <DateTimeField label="終了時刻" value={at} onChange={(iso) => iso && setAt(iso)} />
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={() => setPicking(false)}>
              戻る
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={() => stopAt(at)} disabled={toMs(at) < toMs(entry.startAt)}>
              この時刻で停止
            </button>
          </div>
        </>
      ) : (
        <div className="stack">
          <button type="button" className="btn btn-primary btn-block" onClick={() => stopAt(new Date().toISOString())}>
            今
          </button>
          <button type="button" className="btn btn-block" onClick={() => setPicking(true)}>
            時刻を指定
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onKeep}>
            そのまま続ける
          </button>
        </div>
      )}
    </Sheet>
  )
}
