import { useState } from 'react'
import type { AppData } from '../hooks/useAppData'
import { CategoryEditor, CATEGORY_COLORS } from '../components/CategoryEditor'
import { reorderCategories, saveCategory, saveSettings } from '../data/actions'
import { newId } from '../data/db'
import { useToast } from '../ui/Toast'
import { MinutesField } from '../ui/DateTimeField'
import type { Category } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'

export function SettingsScreen({ data, persisted, onBack }: { data: AppData; persisted: boolean | null; onBack: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState<{ category: Category; isNew: boolean } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const ordered = data.activeCategories.filter((c) => c.id !== SLEEP_CATEGORY_ID)
  const archived = data.categories.filter((c) => c.archived)

  const move = async (index: number, delta: number) => {
    const next = [...ordered]
    const j = index + delta
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    await reorderCategories(next)
  }

  const addNew = () => {
    const color = CATEGORY_COLORS[ordered.length % CATEGORY_COLORS.length]
    setEditing({
      category: { id: newId(), name: '', color, order: ordered.length, mode: 'stopwatch', protect: false, archived: false, updatedAt: '' },
      isNew: true,
    })
  }

  const unarchive = async (c: Category) => {
    await saveCategory({ ...c, archived: false })
    toast.info(`${c.name}を戻しました`)
  }

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
          ‹
        </button>
        <span className="header-title">
          <span className="header-main">設定</span>
        </span>
      </header>

      <h3 className="section-title">止め忘れの検知</h3>
      <p className="muted small">アプリを開いたとき、これより長く動いている計測があれば知らせます。</p>
      <MinutesField label="通常のタイマー" value={data.settings.forgotThresholdMinutes} max={24 * 60} step={30} onChange={(m) => saveSettings({ forgotThresholdMinutes: Math.max(30, m) })} />
      <MinutesField label="睡眠" value={data.settings.sleepForgotThresholdMinutes} max={24 * 60} step={30} onChange={(m) => saveSettings({ sleepForgotThresholdMinutes: Math.max(60, m) })} />

      <h3 className="section-title">タイマー（カテゴリー）</h3>
      <ul className="category-list">
        {ordered.map((c, i) => (
          <li key={c.id} className="category-row">
            <button type="button" className="category-main" onClick={() => setEditing({ category: c, isNew: false })}>
              <span className="card-dot" style={{ background: c.color }} />
              <span>{c.name}</span>
              <span className="muted small">
                {c.mode === 'timer' ? 'タイマー型' : 'ストップウォッチ型'}
                {c.protect ? '・優先' : ''}
              </span>
            </button>
            <span className="reorder">
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                ▲
              </button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === ordered.length - 1} aria-label="下へ">
                ▼
              </button>
            </span>
          </li>
        ))}
        {data.sleepCategory && (
          <li className="category-row">
            <button type="button" className="category-main" onClick={() => setEditing({ category: data.sleepCategory!, isNew: false })}>
              <span className="card-dot" style={{ background: data.sleepCategory.color }} />
              <span>{data.sleepCategory.name}</span>
              <span className="muted small">組み込み（常に最後）</span>
            </button>
          </li>
        )}
      </ul>
      <button type="button" className="add-row" onClick={addNew}>
        ＋ タイマーを追加
      </button>
      {archived.length > 0 && (
        <div className="archived">
          <button type="button" className="link" onClick={() => setShowArchived(!showArchived)}>
            アーカイブ済み（{archived.length}）{showArchived ? 'を隠す' : 'を表示'}
          </button>
          {showArchived && (
            <ul className="category-list">
              {archived.map((c) => (
                <li key={c.id} className="category-row">
                  <span className="category-main">
                    <span className="card-dot" style={{ background: c.color }} />
                    <span className="muted">{c.name}</span>
                  </span>
                  <button type="button" className="link" onClick={() => unarchive(c)}>
                    戻す
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3 className="section-title">保存について</h3>
      <p className="muted small">
        データはこの端末の中だけに保存されます（ログインなし・サーバーなし）。
        {persisted === true && ' 永続保存が有効です。'}
        {persisted === false && ' 永続保存の許可が得られていません。ホーム画面に追加して使うと安定します。'}
        <br />
        ホーム画面に追加したアプリと Safari とでは保存先が別になります。最初からホーム画面のアイコンから使ってください。
      </p>
      <p className="muted small">通知は v0.1 では使えません（iPhone の Web アプリの制約）。バージョン 0.1.0</p>

      {editing && <CategoryEditor category={editing.category} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </div>
  )
}
