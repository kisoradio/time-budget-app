import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { DateTimeField } from '../ui/DateTimeField'
import { toMs } from '../domain/time'

/** 就寝の後入力（§5.5）：「昨夜は何時に寝ましたか？」 */
export function BedtimeDialog({
  defaultBedAt,
  wakeAt,
  onSubmit,
  onClose,
}: {
  defaultBedAt: string
  wakeAt: string
  onSubmit: (bedAt: string | null) => void
  onClose: () => void
}) {
  const [bedAt, setBedAt] = useState<string>(defaultBedAt)
  const invalid = toMs(bedAt) >= toMs(wakeAt)
  return (
    <Sheet title="昨夜は何時に寝ましたか？" onClose={onClose}>
      <p className="muted small">就寝を押していなかったので、睡眠を記録します。動いていた計測はこの時刻で止めます。</p>
      <DateTimeField label="就寝時刻" value={bedAt} onChange={(iso) => iso && setBedAt(iso)} />
      {invalid && <p className="error">就寝時刻は起床より前にしてください</p>}
      <div className="sheet-actions">
        <button type="button" className="btn btn-quiet" onClick={() => onSubmit(null)}>
          寝ていない
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(bedAt)} disabled={invalid}>
          記録して開始
        </button>
      </div>
    </Sheet>
  )
}
