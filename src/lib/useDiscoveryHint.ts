import { useCallback, useState } from 'react'

/** Keeps first-action prompts quiet after a visitor has tried an exhibit once. */
export function useDiscoveryHint(exhibitId: string) {
  const key = `armsteel.discovery-hint.${exhibitId}`
  const [visible, setVisible] = useState(() => {
    try { return window.sessionStorage.getItem(key) !== 'seen' } catch { return true }
  })
  const dismiss = useCallback(() => {
    setVisible(false)
    try { window.sessionStorage.setItem(key, 'seen') } catch { /* The hint still dismisses for this visit. */ }
  }, [key])
  const show = useCallback(() => {
    setVisible(true)
    try { window.sessionStorage.removeItem(key) } catch { /* The hint still opens for this visit. */ }
  }, [key])
  return { visible, dismiss, show }
}
