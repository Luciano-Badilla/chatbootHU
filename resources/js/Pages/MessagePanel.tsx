import { usePage } from "@inertiajs/react"

import { AppShell, AppShellBackButton } from "../components/AppShell"
import { ChatPanel } from "./Chat/ChatPanel"

export default function MessagePanel() {
  const { props } = usePage<{ chats?: any[] }>()
  const chats = props.chats || []

  return (
    <AppShell
      currentPath="/chat-panel"
      title="Panel de Mensajes"
      subtitle="Atencion en tiempo real de conversaciones y derivaciones."
      leading={<AppShellBackButton onClick={() => (window.location.href = `${import.meta.env.VITE_APP_URL}/dashboard`)} />}
      contentClassName="flex-1 min-h-0 p-0"
      fullHeight
    >
      <ChatPanel chats={chats} />
    </AppShell>
  )
}
