import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store/index'
import App from './App.tsx'
import './index.css'

// Expose store for dev/preview testing
;(window as unknown as Record<string, unknown>).__store__ = store

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
