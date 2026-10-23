@extends('layouts.legal')

@section('title', 'Instrucciones para eliminar datos')
@section('description', 'Cómo solicitar al Hospital Universitario de la UNCUYO el acceso o la eliminación de datos del webchat o de WhatsApp.')

@section('content')
    <p class="eyebrow">Tus datos personales</p>
    <h1>Instrucciones para eliminar datos</h1>
    <p class="lead">Podés pedir que revisemos y eliminemos los datos asociados a una conversación del webchat o de WhatsApp, sujeto a las obligaciones legales de conservación aplicables.</p>
    <p class="updated">Hospital Universitario · UNCUYO</p>

    <div class="notice">
        <strong>Cómo hacer la solicitud</strong>
        <p>Escribí a <a href="mailto:info@hospital.uncu.edu.ar?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos">info@hospital.uncu.edu.ar</a> con el asunto “Solicitud de eliminación de datos”. No necesitás iniciar sesión en Facebook ni compartir tu contraseña.</p>
    </div>

    <div class="content-grid">
        <nav class="contents" aria-label="Contenido de las instrucciones">
            <h2>En esta página</h2>
            <ul>
                <li><a href="#pasos">Pasos para solicitarlo</a></li>
                <li><a href="#verificacion">Verificación y respuesta</a></li>
                <li><a href="#alcance">Qué puede eliminarse</a></li>
                <li><a href="#politica">Política de privacidad</a></li>
            </ul>
        </nav>

        <article class="document">
            <section id="pasos">
                <h2>1. Pasos para solicitarlo</h2>
                <ol>
                    <li>Enviá un correo a <a href="mailto:info@hospital.uncu.edu.ar?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos">info@hospital.uncu.edu.ar</a>.</li>
                    <li>Escribí “Solicitud de eliminación de datos” en el asunto.</li>
                    <li>Indicá si nos contactaste por el webchat o por WhatsApp, el nombre que usaste y una fecha aproximada de la conversación. Para WhatsApp, agregá el número con código de país.</li>
                    <li>Si también querés conocer o corregir tus datos, indicalo en el mismo mensaje.</li>
                </ol>
            </section>

            <section id="verificacion">
                <h2>2. Verificación y respuesta</h2>
                <p>El Hospital puede pedir información adicional razonable para comprobar que la solicitud corresponde a la persona titular y localizar la conversación. No envíes contraseñas, historia clínica ni copias de documentos por correo salvo que el Hospital te indique un medio apropiado.</p>
                <p>Te informaremos el resultado por el correo desde el que hiciste la solicitud. Si existe una obligación legal o asistencial de mantener parte de la información, te explicaremos qué datos no pueden eliminarse y por qué.</p>
            </section>

            <section id="alcance">
                <h2>3. Qué puede eliminarse</h2>
                <p>La solicitud puede abarcar el nombre y los datos de contacto de la conversación, los mensajes, los archivos enviados y el token del webchat asociado. El cierre o archivo del chat no elimina esos registros por sí mismo. La eliminación de un mensaje en tu dispositivo o cuenta de WhatsApp tampoco elimina automáticamente la copia que el Hospital recibió y conserva.</p>
                <p>El derecho de supresión se ejerce de acuerdo con la Ley 25.326. Puede haber información que deba conservarse por obligaciones legales, administrativas o asistenciales, o para proteger derechos de terceros.</p>
            </section>

            <section id="politica">
                <h2>4. Política de privacidad</h2>
                <p>Para conocer los datos tratados, sus usos, las integraciones y los demás derechos disponibles, leé nuestra <a href="{{ route('privacy.policy') }}">Política de privacidad</a>.</p>
                <p>El responsable institucional es el Hospital Universitario de la Universidad Nacional de Cuyo, Paso de los Andes 3051, Ciudad de Mendoza, Argentina. También podés escribir a <a href="mailto:info@hospital.uncu.edu.ar">info@hospital.uncu.edu.ar</a>.</p>
            </section>
        </article>
    </div>
@endsection
