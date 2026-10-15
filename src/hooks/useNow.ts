import { useEffect, useState } from 'react'

/**
 * 現在時刻（ミリ秒）。一定間隔で更新し、画面に戻ったときも更新する。
 * 計測は開始時刻との差で表示するので、間隔が多少ずれても累積は狂わない（§6.8）。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    window.addEventListener('pageshow', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
      window.removeEventListener('pageshow', tick)
    }
  }, [intervalMs])
  return now
}

/** 画面が前面に戻ったときに呼ばれる */
export function useOnForeground(handler: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') handler()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', handler)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', handler)
    }
  }, [handler])
}
