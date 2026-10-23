@extends('layouts.legal')

@section('title', 'Política de privacidad')
@section('description', 'Información sobre el tratamiento de datos personales en el webchat y los canales de atención digital del Hospital Universitario de la UNCUYO.')

@section('content')
    <p class="eyebrow">Privacidad y datos personales</p>
    <h1>Política de privacidad</h1>
    <p class="lead">Te contamos qué información se trata cuando usás el webchat del Hospital Universitario, para qué se usa y cómo podés ejercer tus derechos.</p>
    <p class="updated">Vigente desde el 22 de octubre de 2026</p>

    <div class="notice">
        <strong>Una diferencia importante</strong>
        <p>Los mensajes enviados por el webchat se procesan en los sistemas del Hospital y no se envían a la API de WhatsApp de Meta. Si elegís comunicarte por WhatsApp, tus mensajes se procesan además mediante WhatsApp Business Platform, de acuerdo con las condiciones de WhatsApp y Meta.</p>
    </div>

    <div class="content-grid">
        <nav class="contents" aria-label="Contenido de la política">
            <h2>En esta página</h2>
            <ul>
                <li><a href="#responsable">Responsable y contacto</a></li>
                <li><a href="#datos">Datos que tratamos</a></li>
                <li><a href="#finalidades">Para qué los usamos</a></li>
                <li><a href="#integraciones">Servicios e integraciones</a></li>
                <li><a href="#conservacion">Conservación</a></li>
                <li><a href="#seguridad">Seguridad y confidencialidad</a></li>
                <li><a href="#derechos">Tus derechos</a></li>
                <li><a href="#eliminacion-de-datos">Pedir eliminación</a></li>
                <li><a href="#cambios">Cambios de esta política</a></li>
            </ul>
        </nav>

        <article class="document">
            <section id="responsable">
                <h2>1. Responsable y contacto</h2>
                <p>El responsable institucional del tratamiento es el <strong>Hospital Universitario de la Universidad Nacional de Cuyo (UNCUYO)</strong>, con domicilio en Paso de los Andes 3051, Ciudad de Mendoza, Provincia de Mendoza, Argentina.</p>
                <p>Para consultas sobre privacidad o para ejercer tus derechos, escribí a <a href="mailto:info@hospital.uncu.edu.ar?subject=Privacidad%20y%20datos%20personales">info@hospital.uncu.edu.ar</a>.</p>
            </section>

            <section id="datos">
                <h2>2. Datos que tratamos</h2>
                <p>La información depende del canal y de lo que compartas durante la atención. El webchat no requiere una cuenta: para iniciar una conversación solicita tu nombre y genera un identificador aleatorio que permite recuperar esa conversación desde el mismo navegador.</p>
                <ul>
                    <li><strong>Datos de conversación:</strong> nombre, mensajes, opciones seleccionadas, fecha y hora, estado de la atención y, cuando corresponda, nombre del operador que responde.</li>
                    <li><strong>Archivos y datos que elegís enviar:</strong> fotos, documentos, audio o video; datos de contacto; y ubicación, dirección o coordenadas. El navegador también puede pedirte permiso para compartir tu ubicación actual.</li>
                    <li><strong>Datos de salud o identificación:</strong> si una consulta o un flujo de atención los solicita, podrías compartir DNI, información de salud, cobertura, turnos u otros datos relacionados. Los datos de salud son sensibles. Compartí solo lo necesario para tu consulta.</li>
                    <li><strong>Datos técnicos:</strong> identificador de la conversación, información de sesión y registros técnicos necesarios para que el servicio funcione, prevenir usos indebidos y resolver errores. El servidor y el proveedor de alojamiento también pueden registrar datos de conexión, como la dirección IP, la fecha y el navegador.</li>
                </ul>
                <p>El webchat conserva en el almacenamiento local del navegador un token aleatorio para retomar una conversación. También utiliza cookies técnicas necesarias para la sesión y la seguridad del sitio.</p>
            </section>

            <section id="finalidades">
                <h2>3. Para qué usamos la información</h2>
                <p>Usamos los datos para recibir y responder consultas, mantener el historial de la conversación, derivarla al equipo de atención cuando corresponde y operar, proteger y mejorar el canal.</p>
                <p>Cuando el flujo de atención lo requiere, podemos usar información para verificar datos de una persona o ayudar con consultas y gestiones de turnos. El webchat es un canal de comunicación y no reemplaza una consulta médica ni los canales de emergencia.</p>
                <p>Si activás las notificaciones del navegador, usamos los datos técnicos de esa suscripción para avisarte que llegó una respuesta. La notificación no incluye el contenido del mensaje. Podés desactivarla desde el navegador o desde el control de notificaciones del webchat.</p>
            </section>

            <section id="integraciones">
                <h2>4. Servicios e integraciones</h2>
                <p>Solo compartimos información cuando es necesaria para prestar el servicio, cumplir una obligación o responder a una solicitud tuya. Según el canal y las funciones habilitadas, pueden intervenir:</p>
                <ul>
                    <li><strong>WhatsApp Business Platform y Meta:</strong> para las conversaciones que ocurren por WhatsApp, Meta procesa los datos necesarios para enviar y recibir mensajes y estados de entrega, incluidos el número o identificador de WhatsApp, el contenido enviado, archivos y datos técnicos del mensaje. Consultá las <a href="https://www.whatsapp.com/legal/business-data-processing-terms" rel="noopener noreferrer">condiciones de tratamiento de datos de WhatsApp Business</a> y la <a href="https://www.facebook.com/privacy/policy/" rel="noopener noreferrer">Política de privacidad de Meta</a>. El sistema de webchat no usa Facebook Login ni solicita acceso a un perfil personal de Facebook.</li>
                    <li><strong>Sistemas institucionales de pacientes y turnos:</strong> si una función de atención se encuentra habilitada y la usás, los datos necesarios —por ejemplo, DNI, especialidad o turno— pueden consultarse o enviarse a los sistemas de gestión de la institución, incluida la integración con Alephoo.</li>
                    <li><strong>Búsqueda y visualización de mapas:</strong> al buscar una dirección, el texto de búsqueda se consulta con Photon, un servicio de Komoot. Los mapas pueden cargar recursos de OpenStreetMap. Si enviás una ubicación en el chat, esta se conserva como parte del mensaje.</li>
                    <li><strong>Notificaciones del navegador y alojamiento:</strong> si las activás, el proveedor de notificaciones de tu navegador entrega el aviso. Los proveedores técnicos que alojan o mantienen el servicio pueden tratar datos bajo instrucciones institucionales y para prestar esas funciones.</li>
                </ul>
                <p>Estos prestadores pueden operar infraestructura en otros países. En esos casos, el tratamiento queda sujeto a sus condiciones, a las medidas contractuales aplicables y a la normativa vigente.</p>
            </section>

            <section id="conservacion">
                <h2>5. Conservación</h2>
                <p>Las conversaciones y los archivos se conservan en los sistemas institucionales mientras sean necesarios para atender y documentar la gestión, y durante los plazos que exijan las obligaciones asistenciales, administrativas o legales aplicables. Esta plataforma no tiene un plazo único de borrado automático para todos los chats. Cerrar o archivar una conversación no significa que sus datos se hayan eliminado.</p>
                <p>Cuando los datos ya no sean necesarios y no exista una obligación de conservarlos, se eliminan o se disocian de manera que no permitan identificarte, de acuerdo con los procedimientos aplicables.</p>
            </section>

            <section id="seguridad">
                <h2>6. Seguridad y confidencialidad</h2>
                <p>Aplicamos controles técnicos y organizativos para proteger la información y limitar el acceso al personal que necesita intervenir en la atención o en el mantenimiento del servicio. Las personas que acceden a datos personales deben mantener su confidencialidad. Ningún sistema conectado a Internet puede garantizar seguridad absoluta.</p>
            </section>

            <section id="derechos">
                <h2>7. Tus derechos</h2>
                <p>Podés solicitar acceso a tus datos y pedir que se actualicen, rectifiquen o supriman cuando corresponda. Para iniciar el trámite, escribí a <a href="mailto:info@hospital.uncu.edu.ar?subject=Solicitud%20sobre%20mis%20datos">info@hospital.uncu.edu.ar</a>, indicando qué derecho querés ejercer y el canal en el que conversaste. Podemos pedirte información razonable para verificar tu identidad y encontrar los datos; evitá enviar información de salud que no sea necesaria para identificar la solicitud.</p>
                <p>La Ley 25.326 establece que el acceso es gratuito con intervalos no inferiores a seis meses, salvo que exista un interés legítimo, y prevé un plazo de hasta diez días corridos para responder. Las solicitudes de rectificación, actualización o supresión deben atenderse dentro de cinco días hábiles cuando resulten procedentes. La supresión puede limitarse si existe una obligación legal de conservar la información o se afectan derechos de terceros.</p>
                <p>Si considerás que tus derechos no fueron atendidos, podés presentar un reclamo ante la <a href="https://www.argentina.gob.ar/aaip/datospersonales/derechos" rel="noopener noreferrer">Agencia de Acceso a la Información Pública (AAIP)</a>, autoridad de control de la Ley 25.326.</p>
            </section>

            <section id="eliminacion-de-datos">
                <h2>8. Solicitar la eliminación de datos</h2>
                <p>Podés pedir la eliminación de los datos asociados a una conversación del webchat o de WhatsApp. Enviá un correo a <a href="mailto:info@hospital.uncu.edu.ar?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos">info@hospital.uncu.edu.ar</a> con el asunto <strong>“Solicitud de eliminación de datos”</strong>.</p>
                <p>Indicá el canal que usaste, el nombre proporcionado y, si corresponde, el número de WhatsApp desde el que nos escribiste, con código de país. No incluyas historia clínica, contraseñas ni documentos adjuntos salvo que te los pidamos por un medio adecuado para verificar la solicitud. Revisaremos la identidad y el alcance del pedido y te informaremos el resultado. Podemos conservar los datos que una norma nos obligue a mantener.</p>
                <p>También podés consultar la página de <a href="{{ route('privacy.data-deletion') }}">instrucciones para eliminar datos</a>. Si escribiste por WhatsApp, el borrado de una conversación en tu teléfono no elimina por sí solo la copia que el Hospital mantiene en sus sistemas; solicitá la eliminación directamente al Hospital.</p>
            </section>

            <section id="cambios">
                <h2>9. Cambios de esta política</h2>
                <p>Podemos actualizar esta política cuando cambien el servicio, sus integraciones o las normas aplicables. Publicaremos la versión vigente en esta página e indicaremos la fecha de actualización.</p>
                <p>La normativa de referencia es la <a href="https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion" rel="noopener noreferrer">Ley 25.326 de Protección de los Datos Personales</a> y sus normas complementarias.</p>
            </section>
        </article>
    </div>
@endsection
