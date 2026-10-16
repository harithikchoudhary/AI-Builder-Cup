import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export default function ThemeToggle() {
  const [theme, setTheme] = useState('light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121519' : '#f7f8fa')
  }, [theme])
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
  return <button className="header-icon-button theme-switch" type="button" aria-label={label} title={label} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
    {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
  </button>
}
