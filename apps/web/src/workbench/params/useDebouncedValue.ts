import { useEffect, useState } from 'react'

/** 值防抖:输入停稳 ms 毫秒后才跟随(实时预览用,避免逐键跑核)。 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}
