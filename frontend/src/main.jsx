import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { WSProvider } from './WebSocketContext'
import { CurrencyProvider } from './CurrencyContext'
import { AuditProvider } from './AuditContext'
import { LanguageProvider } from './LanguageContext'
import './index.css'
import './stitch-midnight.css'
import { installCsrfFetchProtection } from './csrfFetch'
import App from './App.jsx'
import { SystemConfirmHost } from './SystemConfirm.jsx'

installCsrfFetchProtection()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WSProvider>
          <LanguageProvider>
            <CurrencyProvider>
              <AuditProvider>
                <App />
                <SystemConfirmHost />
              </AuditProvider>
            </CurrencyProvider>
          </LanguageProvider>
        </WSProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
