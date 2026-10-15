import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface PressableOptions {
  onTap?: () => void
  onLongPress?: () => void
  /** 長押しと判定するまでの時間 */
  longPressMs?: number
  /** これ以上指が動いたらスクロールとみなしてタップを無効にする（§7.3） */
  moveThresholdPx?: number
  disabled?: boolean
}

/**
 * タップと長押しを判定する。
 * - 指が動いた（スクロール）ときはタップを発火しない。
 * - 長押しが成立したら、指を離してもタップは発火しない。
 */
export function usePressable({ onTap, onLongPress, longPressMs = 500, moveThresholdPx = 10, disabled }: PressableOptions) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const longFired = useRef(false)
  const cancelled = useRef(false)
  const [pressing, setPressing] = useState(false)
  const [longPressing, setLongPressing] = useState(false)

  const reset = useCallback(() => {
    window.clearTimeout(timer.current)
    start.current = null
    setPressing(false)
    setLongPressing(false)
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) return
      if (e.button !== undefined && e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      longFired.current = false
      cancelled.current = false
      setPressing(true)
      window.clearTimeout(timer.current)
      if (onLongPress) {
        timer.current = window.setTimeout(() => {
          if (!start.current || cancelled.current) return
          longFired.current = true
          setLongPressing(true)
          onLongPress()
        }, longPressMs)
      }
    },
    [disabled, longPressMs, onLongPress],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!start.current || cancelled.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      if (Math.hypot(dx, dy) > moveThresholdPx) {
        cancelled.current = true
        window.clearTimeout(timer.current)
        setPressing(false)
      }
    },
    [moveThresholdPx],
  )

  const onPointerUp = useCallback(() => {
    if (!start.current) return
    const fire = !cancelled.current && !longFired.current
    reset()
    if (fire && onTap) onTap()
  }, [onTap, reset])

  const onPointerCancel = useCallback(() => {
    cancelled.current = true
    reset()
  }, [reset])

  const onContextMenu = useCallback((e: ReactPointerEvent | { preventDefault: () => void }) => {
    // 長押しでメニューが出ないようにする
    e.preventDefault()
  }, [])

  return {
    pressing,
    longPressing,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave: onPointerCancel, onContextMenu },
  }
}
