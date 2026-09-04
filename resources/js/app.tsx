import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInertiaApp } from '@inertiajs/react'
import { Toaster } from 'sonner'
import '../css/app.css'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.tsx')
    const page = pages[`./Pages/${name}.tsx`]

    if (!page) {
      throw new Error(`Page not found: ./Pages/${name}.tsx`)
    }

    return page().then((module) => module.default)
  },
  setup({ el, App, props }) {
    createRoot(el).render(
      <>
        <App {...props} />
        <Toaster
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            className: 'font-sans',
          }}
        />
      </>,
    )
  },
})
