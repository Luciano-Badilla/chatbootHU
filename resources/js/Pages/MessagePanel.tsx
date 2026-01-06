import { ChatPanel } from "./Chat/ChatPanel"
import { Button } from "shadcn/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { usePage } from "@inertiajs/react"

export default function MessagePanel() {
  // usePage() permite acceder a las props enviadas desde Laravel vía Inertia
  const { props } = usePage()

  // "chats" llega desde el controlador de Laravel -> return Inertia::render(...)
  const chats = props.chats || []

  return (
    <div className="max-h-screen bg-[#f4f8fb] flex flex-col">
      <header className="border-b border-[#dbe5ef] bg-[#013765] backdrop-blur-sm px-6 py-3">
        <div className="flex items-center space-x-4">
          {/* 
            Botón para volver al Dashboard.
            Se usa import.meta.env porque Vite maneja variables de entorno para React.
          */}
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-[#024a8a]"
            onClick={() =>
              (window.location.href = `${import.meta.env.VITE_APP_URL}/dashboard`) //Variable "VITE_APP_URL" del .env
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver al Dashboard
          </Button>

          <h1 className="text-lg font-semibold text-white">Panel de Mensajes</h1>
        </div>
      </header>

      <div className="flex-1">
        {/* 
          Componente que renderiza los chats.
          Recibe la data entregada por Laravel mediante Inertia.
        */}
        <ChatPanel chats={chats} />
      </div>
    </div>
  )
}
