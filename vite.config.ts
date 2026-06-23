import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // host: true — открывает дев-сервер в локальной сети, чтобы можно было
    // тестировать с телефона по адресу http://<IP-компьютера>:5173
    host: true,
    proxy: {
      '/api': 'http://localhost:4174',
    },
  },
})
