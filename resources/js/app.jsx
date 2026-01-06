import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInertiaApp } from '@inertiajs/react'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.{jsx,tsx}')
    const page = pages[`./Pages/${name}.jsx`] || pages[`./Pages/${name}.tsx`]

    if (!page) {
      throw new Error(`Page not found: ./Pages/${name}.(jsx|tsx)`)
    }

    return page().then((module) => module.default)
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
})
