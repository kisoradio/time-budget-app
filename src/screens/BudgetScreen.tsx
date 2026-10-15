import { useMemo, useState } from 'react'
import type { AppData } from '../hooks/useAppData'
import { Donut } from '../components/Donut'
import { CategoryEditor } from '../components/CategoryEditor'
import { newCategoryDraft } from './TodayScreen'
import { MinutesField } from '../ui/DateTimeField'
import { useToast } from '../ui/Toast'
import { updateCycleBudgets, updateTemplateBudgets } from '../data/actions'
import { budgetSummary, currentCycle } from '../domain/cycles'
import { formatMinutes } from '../domain/time'
import type { BudgetMap } from '../domain/types'

type Target = 'cycle' | 'template'

/** 配分タブ（§8.3、§4.2、§4.3） */
export function BudgetScreen({ data }: { data: AppData }) {
  const toast = useToast()
  const cycle = useMemo(() => currentCycle(data.cycles), [data.cycles])
  const [target, setTarget] = useState<Target>(cycle ? 'cycle' : 'template')
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ target: Target; key: string; budgets: BudgetMap } | null>(null)
  const [adding, setAdding] = useState(false)

  const effectiveTarget: Target = cycle ? target : 'template'
  const sourceKey = effectiveTarget === 'cycle' ? `cycle:${cycle?.id}:${cycle?.updatedAt}` : `template:${data.template?.updatedAt}`
  const source: BudgetMap = effectiveTarget === 'cycle' ? cycle?.budgets ?? {} : data.template?.budgets ?? {}
  const budgets = draft && draft.target === effectiveTarget && draft.key === sourceKey ? draft.budgets : source
  const dirty = draft !== null && draft.target === effectiveTarget && draft.key === sourceKey
  const summary = budgetSummary(budgets, data.categories)

  const setMinutes = (id: string, min: number) => {
    setDraft({ target: effectiveTarget, key: sourceKey, budgets: { ...budgets, [id]: min } })
  }

  const save = async () => {
    if (effectiveTarget === 'cycle' && cycle) {
      await updateCycleBudgets(cycle, budgets)
      toast.info('このサイクルの予算を保存しました')
    } else {
      await updateTemplateBudgets(budgets)
      toast.info('テンプレートを保存しました（次のサイクルから）')
    }
    setDraft(null)
  }

  return (
    <div className="screen">
      <header className="header">
        <span className="header-title">
          <span className="header-main">配分</span>
        </span>
      </header>
      {cycle && (
        <div className="segmented">
          <button type="button" className={effectiveTarget === 'cycle' ? 'selected' : ''} onClick={() => setTarget('cycle')}>
            今のサイクル
          </button>
          <button type="button" className={effectiveTarget === 'template' ? 'selected' : ''} onClick={() => setTarget('template')}>
            テンプレート（次回から）
          </button>
        </div>
      )}
      {!cycle && <p className="muted small center">まだサイクルが始まっていません。テンプレートの予算が「今日を開始」のときにコピーされます。</p>}
      <Donut budgets={budgets} categories={data.activeCategories} selectedId={selected} onSelect={setSelected} />
      <p className="center">
        合計 {formatMinutes(summary.totalMinutes)} ／ 24:00
        {summary.unallocatedMinutes > 0 && <span className="muted">　未配分 {formatMinutes(summary.unallocatedMinutes)}</span>}
      </p>
      {summary.overMinutes > 0 && <p className="warn center">合計が24時間を {formatMinutes(summary.overMinutes)} 超えています（このまま保存できます）</p>}
      <ul className="budget-list">
        {data.activeCategories.map((c) => (
          <li key={c.id} className={`budget-row ${selected === c.id ? 'selected' : ''}`} onClick={() => setSelected(c.id)}>
            <span className="budget-name">
              <span className="card-dot" style={{ background: c.color }} />
              {c.name}
              <span className="muted small"> {c.mode === 'timer' ? 'タイマー型' : c.mode === 'sleep' ? '' : 'ストップウォッチ型'}</span>
            </span>
            <MinutesField value={budgets[c.id] ?? 0} onChange={(min) => setMinutes(c.id, min)} />
          </li>
        ))}
        <li>
          <button type="button" className="add-row" onClick={() => setAdding(true)}>
            ＋ タイマーを追加
          </button>
        </li>
      </ul>
      {adding && <CategoryEditor category={newCategoryDraft(data.activeCategories.length - 1)} isNew onClose={() => setAdding(false)} />}
      <div className="sheet-actions sticky-actions">
        <span className="spacer" />
        {dirty && (
          <button type="button" className="btn" onClick={() => setDraft(null)}>
            元に戻す
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty}>
          保存
        </button>
      </div>
    </div>
  )
}
