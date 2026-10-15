import type { ReactNode } from 'react'

/** 画面下から出るシート。確認ダイアログではなく、入力や選択に使う。 */
export function Sheet({ title, children, onClose }: { title?: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
