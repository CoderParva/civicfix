import { useEffect } from 'react'

/**
 * Switches the page to the bold citizen theme (civic.css) while the calling layout is mounted. It sets the
 * attribute on <html>, not on a wrapper, so portalled UI (dialogs, toasts) is themed as well; the staff layouts
 * never call this, so officer and admin pages keep their own quieter design.
 */
export function useCivicTheme() {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = 'civic'
    return () => {
      if (root.dataset.theme === 'civic') delete root.dataset.theme
    }
  }, [])
}
