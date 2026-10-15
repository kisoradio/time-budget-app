import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActionResult } from '../data/actions'

interface ToastState {
  message: string
  undo?: () => Promise<void>
  key: number
}

interface ToastApi {
  /** 操作結果を表示する。undo があれば「取り消す」ボタンを出す（§6.7）。 */
  show: (result: { message: string; undo?: () => Promise<void> } | ActionResult) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi>({ show: () => {}, info: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children, durationMs = 3000 }: { children: ReactNode; durationMs?: number }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((result: { message: string; undo?: () => Promise<void> }) => {
    setToast({ message: result.message, undo: result.undo, key: Date.now() })
  }, [])
  const info = useCallback((message: string) => show({ message }), [show])

  useEffect(() => {
    if (!toast) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), durationMs)
    return () => window.clearTimeout(timer.current)
  }, [toast, durationMs])

  const onUndo = async () => {
    if (!toast?.undo) return
    const undo = toast.undo
    setToast(null)
    try {
      await undo()
      setToast({ message: '取り消しました', key: Date.now() })
    } catch (e) {
      setToast({ message: '取り消せませんでした', key: Date.now() })
      console.error(e)
    }
  }

  return (
    <ToastContext.Provider value={{ show, info }}>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.key}>
          <span className="toast-message">{toast.message}</span>
          {toast.undo && (
            <button type="button" className="toast-undo" onClick={onUndo}>
              取り消す
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}
