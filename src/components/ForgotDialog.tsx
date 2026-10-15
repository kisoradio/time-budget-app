import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { DateTimeField } from '../ui/DateTimeField'
import { startCycle, stopMeasuring } from '../data/actions'
import { useToast } from '../ui/Toast'
import { formatMs, toMs } from '../domain/time'
import type { Category, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

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
  const isSleep = entry.kind === 'sleep' || entry.categoryId === SLEEP_CATEGORY_ID

  const stopAt = async (iso: string) => {
    if (toMs(iso) < toMs(entry.startAt)) return
    // 睡眠の止め忘れは「起床」として扱い、その時刻から新しいサイクルを始める（§5.4）
    const r = isSleep ? await startCycle({ wakeAt: iso }) : await stopMeasuring(entry, name, iso)
    toast.show(r)
    onDone()
  }

  return (
    <Sheet title="止め忘れていませんか" onClose={onKeep}>
      <p>
        {name}が {formatMs(elapsedMs)} 動いています。{isSleep ? 'いつ起きましたか？' : 'いつ終わりましたか？'}
      </p>
      {picking ? (
        <>
          <DateTimeField label={isSleep ? '起床時刻' : '終了時刻'} value={at} onChange={(iso) => iso && setAt(iso)} />
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={() => setPicking(false)}>
              戻る
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={() => stopAt(at)} disabled={toMs(at) < toMs(entry.startAt)}>
              {isSleep ? 'この時刻に起床' : 'この時刻で停止'}
            </button>
          </div>
        </>
      ) : (
        <div className="stack">
          <button type="button" className="btn btn-primary btn-block" onClick={() => stopAt(new Date().toISOString())}>
            {isSleep ? '今起きた（今日を開始）' : '今'}
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
