// Runs before the first paint (a blocking script in <head>): without it a dark-theme reload
// shows light first, then flips when React mounts. Keep the logic in step with use-theme.ts.
// A file and not inline, so the Content-Security-Policy needs no 'unsafe-inline' for scripts.
;(function () {
  var stored = localStorage.getItem('vana-dash-theme')
  var isDark = stored === 'dark' || ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  var palette = localStorage.getItem('vana-dash-palette')
  if (palette && palette !== 'vanadium' && /^(grafit|padure|chihlimbar|ardezie)$/.test(palette)) {
    document.documentElement.dataset.palette = palette
  }
})()
