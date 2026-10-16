import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/ibm-plex-sans-thai/thai-400.css"
import "@fontsource/ibm-plex-sans-thai/thai-500.css"
import "@fontsource/ibm-plex-sans-thai/thai-600.css"
import "@fontsource/ibm-plex-sans-thai/thai-700.css"
import "@fontsource/ibm-plex-sans-thai/latin-400.css"
import "@fontsource/ibm-plex-sans-thai/latin-500.css"
import "@fontsource/ibm-plex-sans-thai/latin-600.css"
import "@fontsource/ibm-plex-sans-thai/latin-700.css"
import "@fontsource/jetbrains-mono/latin-500.css"
import "@fontsource/jetbrains-mono/latin-600.css"
import "./index.css"
import App from "./App"
import { ConfirmProvider } from "./ui"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
)
