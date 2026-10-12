import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'systems.vanadium.dash',
  appName: 'VanaDash',
  webDir: 'dist',
  server: {
    url: 'https://dash.vanadium.systems',
    cleartext: false,
  },
}

export default config
