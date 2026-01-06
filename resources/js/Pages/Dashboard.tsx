import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shadcn/components/ui/card"
import { Button } from "shadcn/components/ui/button"
import { Badge } from "shadcn/components/ui/badge"
import { MessageSquare, Users, BarChart3, Settings, Bell, FileText, Plus } from "lucide-react"

// Vista principal del Dashboard de la SPA (React + Inertia + Laravel) ES TODO PLACEHOLDER no son datos reales
export default function Dashboard() {
  return (
    <div className="min-h-screen bg-[#f4f8fb]">
      {/* Header del Dashboard */}
      <header className="border-b border-[#dbe5ef] bg-[#013765] backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-[#013765]" />
              </div>
              <h1 className="text-xl font-semibold text-white">Dashboard</h1>
            </div>
            <div className="flex items-center space-x-3">
              {/* 
                Botón genérico de "Nuevo".
                Actualmente solo UI; si se desea, acá se puede conectar con alguna ruta de Inertia o acción concreta.
              */}
              <Button variant="outline" size="sm" className="border-white text-white hover:bg-[#024a8a]">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo
              </Button>
              <Button variant="ghost" size="sm" className="text-white hover:bg-[#024a8a]">
                <Bell className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-white hover:bg-[#024a8a]">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Tarjetas de métricas principales.
           Actualmente los datos son estáticos (placeholders).
           Se pueden reemplazar por valores reales viniendo desde Laravel vía Inertia (props).
        */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#013765]">Mensajes Totales</CardTitle>
              <MessageSquare className="h-4 w-4 text-[#013765]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#013765]">2,847</div>
              <p className="text-xs text-[#013765]/70">+12% desde el mes pasado</p>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#013765]">Chats Activos</CardTitle>
              <Users className="h-4 w-4 text-[#013765]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#013765]">156</div>
              <p className="text-xs text-[#013765]/70">+8% desde la semana pasada</p>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#013765]">Variables Generadas</CardTitle>
              <BarChart3 className="h-4 w-4 text-[#013765]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#013765]">1,234</div>
              <p className="text-xs text-[#013765]/70">+23% desde el mes pasado</p>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#013765]">Tiempo Promedio</CardTitle>
              <FileText className="h-4 w-4 text-[#013765]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#013765]">4.2m</div>
              <p className="text-xs text-[#013765]/70">-2% desde la semana pasada</p>
            </CardContent>
          </Card>
        </div>

        {/* Acciones rápidas:
           El botón principal navega al panel de chat.
           Se arma la URL usando la variable de entorno de Vite (VITE_APP_URL),
           que debe apuntar al dominio/base URL configurado en Laravel.
        */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-[#013765]">Acciones Rápidas</CardTitle>
              <CardDescription className="text-[#013765]/70">
                Accede a las funciones principales del sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                className="w-full justify-start bg-[#013765] text-white hover:bg-[#024a8a]"
                size="lg"
                onClick={() =>
                  (window.location.href = `${import.meta.env.VITE_APP_URL}/chat-panel`)
                }
              >
                <MessageSquare className="h-5 w-5 mr-3" />
                Abrir Panel de Mensajes
              </Button>

              {/* Estos botones son sólo UI por ahora.
                 Se pueden enlazar a rutas de Inertia (por ejemplo route('users.index')) si se definen en Laravel.
              */}
              <Button
                variant="outline"
                className="w-full justify-start border-[#013765] text-[#013765] hover:bg-[#f0f4f8]"
                size="lg"
              >
                <Users className="h-5 w-5 mr-3" />
                Gestionar Usuarios
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start border-[#013765] text-[#013765] hover:bg-[#f0f4f8]"
                size="lg"
              >
                <BarChart3 className="h-5 w-5 mr-3" />
                Ver Analíticas
              </Button>
            </CardContent>
          </Card>

          {/* Actividad reciente: datos mockeados. 
             Sirve como ejemplo visual; se puede alimentar con eventos reales desde la base.
          */}
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-[#013765]">Actividad Reciente</CardTitle>
              <CardDescription className="text-[#013765]/70">
                Últimas acciones en el sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#013765]">Nuevo chat iniciado</p>
                    <p className="text-xs text-[#013765]/70">hace 2 minutos</p>
                  </div>
                  <Badge variant="secondary" className="text-[#013765]">
                    Chat
                  </Badge>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-[#013765]"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#013765]">
                      Variable generada: user_preference
                    </p>
                    <p className="text-xs text-[#013765]/70">hace 5 minutos</p>
                  </div>
                  <Badge variant="secondary" className="text-[#013765]">
                    Variable
                  </Badge>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-orange-500"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#013765]">Usuario conectado</p>
                    <p className="text-xs text-[#013765]/70">hace 8 minutos</p>
                  </div>
                  <Badge variant="secondary" className="text-[#013765]">
                    Usuario
                  </Badge>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#013765]">Análisis completado</p>
                    <p className="text-xs text-[#013765]/70">hace 12 minutos</p>
                  </div>
                  <Badge variant="secondary" className="text-[#013765]">
                    Sistema
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Estado del sistema: también es una sección visual, pensada para mostrar healthchecks reales si se integran más adelante */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-[#013765]">Estado del Sistema</CardTitle>
            <CardDescription className="text-[#013765]/70">
              Monitoreo en tiempo real de los servicios
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-3">
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
                <div>
                  <p className="text-sm font-medium text-[#013765]">API de Mensajes</p>
                  <p className="text-xs text-[#013765]/70">Operativo</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
                <div>
                  <p className="text-sm font-medium text-[#013765]">Base de Datos</p>
                  <p className="text-xs text-[#013765]/70">Operativo</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                <div>
                  <p className="text-sm font-medium text-[#013765]">Procesamiento IA</p>
                  <p className="text-xs text-[#013765]/70">Carga Alta</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
