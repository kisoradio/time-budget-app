import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { archiveCategory, saveCategory } from '../data/actions'
import { useToast } from '../ui/Toast'
import type { Category } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

export const CATEGORY_COLORS = ['#6a8caf', '#f2c14e', '#8fbc8f', '#e07a5f', '#5b5f97', '#c08497', '#7fb7be', '#d8a47f', '#9a8c98', '#6b9080']

/** カテゴリーの作成・編集・アーカイブ（§4.1） */
export function CategoryEditor({ category, isNew, onClose }: { category: Category; isNew?: boolean; onClose: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Category>(category)
  const isSleep = category.id === SLEEP_CATEGORY_ID

  const save = async () => {
    const name = draft.name.trim()
    if (!name) return
    await saveCategory({ ...draft, name })
    toast.info(isNew ? `${name}を追加しました` : '保存しました')
    onClose()
  }

  const archive = async () => {
    const r = await archiveCategory(category)
    toast.show(r)
    onClose()
  }

  return (
    <Sheet title={isNew ? 'カテゴリーを追加' : 'カテゴリー設定'} onClose={onClose}>
      <label className="field">
        <span className="field-label">名前</span>
        <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={20} />
      </label>
      <div className="field">
        <span className="field-label">色</span>
        <div className="color-row">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${draft.color === c ? 'selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => setDraft({ ...draft, color: c })}
            />
          ))}
        </div>
      </div>
      {!isSleep && (
        <div className="field">
          <span className="field-label">計測モード</span>
          <div className="segmented">
            <button type="button" className={draft.mode === 'stopwatch' ? 'selected' : ''} onClick={() => setDraft({ ...draft, mode: 'stopwatch' })}>
              ストップウォッチ型
            </button>
            <button type="button" className={draft.mode === 'timer' ? 'selected' : ''} onClick={() => setDraft({ ...draft, mode: 'timer' })}>
              タイマー型
            </button>
          </div>
          <p className="muted small">
            {draft.mode === 'stopwatch' ? '目標以上に取り組んでよい活動。超過は肯定的に表示します。' : '時間を絞りたい活動。残り時間を表示し、尽きたら超過を記録します。'}
          </p>
        </div>
      )}
      {isSleep && <p className="muted small">睡眠は組み込みのカテゴリーです。予算に対する不足・超過だけを表示します。</p>}
      <label className="field field-inline">
        <input type="checkbox" checked={draft.protect} onChange={(e) => setDraft({ ...draft, protect: e.target.checked })} />
        <span>優先して守る</span>
      </label>
      <div className="sheet-actions">
        {!isNew && !isSleep && (
          <button type="button" className="btn btn-danger" onClick={archive}>
            アーカイブ
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
          保存
        </button>
      </div>
    </Sheet>
  )
}
