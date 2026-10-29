/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', content: ['./index.html','./src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { ink:'#050816', panel:'#0a1122', card:'#0e1830', border:'#1b2a4a', accent:'#0ea5e9', cyanx:'#22d3ee', silver:'#e6edf7', muted:'#8aa0c2' },
    fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
    boxShadow: { glow:'0 0 32px rgba(14,165,233,.35)', card:'0 12px 32px rgba(0,0,0,.45)' },
    borderRadius: { '2xl':'1.25rem' }
  }},
  plugins: []
}
