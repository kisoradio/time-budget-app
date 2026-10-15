import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

const REVEAL_PX = 96

/**
 * 左にスライドすると右側に「削除」が出る行。
 * - 横方向の動きだけを拾い、縦のスクロールやタップは中の要素にそのまま渡す。
 * - 開いている行は1つだけ（open / onOpenChange で親が管理）。
 */
export function SwipeRow({
  children,
  open,
  onOpenChange,
  onDelete,
  deleteLabel = '削除',
  disabled,
}: {
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  deleteLabel?: string
  disabled?: boolean
}) {
  const start = useRef<{ x: number; y: number; base: number } | null>(null)
  const swiping = useRef(false)
  const justSwiped = useRef(false)
  const [dx, setDx] = useState(open ? -REVEAL_PX : 0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) setDx(open ? -REVEAL_PX : 0)
  }, [open, dragging])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || e.pointerType === 'mouse' && e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY, base: open ? -REVEAL_PX : 0 }
      swiping.current = false
    },
    [disabled, open],
  )

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!start.current) return
    const mx = e.clientX - start.current.x
    const my = e.clientY - start.current.y
    if (!swiping.current) {
      if (Math.abs(mx) < 12 || Math.abs(mx) < Math.abs(my) * 1.5) return
      swiping.current = true
      setDragging(true)
    }
    setDx(Math.max(-REVEAL_PX - 16, Math.min(0, start.current.base + mx)))
  }, [])

  const onPointerUp = useCallback(() => {
    if (!start.current) return
    const wasSwiping = swiping.current
    start.current = null
    swiping.current = false
    setDragging(false)
    if (wasSwiping) {
      // スライド直後に指を離した場所のボタンが押されないようにする
      justSwiped.current = true
      window.setTimeout(() => {
        justSwiped.current = false
      }, 300)
      onOpenChange(dx < -REVEAL_PX / 2)
    } else if (open) onOpenChange(false)
  }, [dx, onOpenChange, open])

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (justSwiped.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  const onPointerCancel = useCallback(() => {
    start.current = null
    swiping.current = false
    setDragging(false)
    setDx(open ? -REVEAL_PX : 0)
  }, [open])

  return (
    <div className={`swipe-row ${open ? 'open' : ''} ${dragging ? 'dragging' : ''}`}>
      <button type="button" className="swipe-delete" onClick={onDelete} tabIndex={open ? 0 : -1} aria-hidden={!open}>
        {deleteLabel}
      </button>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
