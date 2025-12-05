# Informe Detallado del Sistema de Notificaciones Push

Este documento describe el flujo completo del sistema de notificaciones, desde el evento que lo origina en la base de datos hasta que la notificación aparece en el dispositivo del usuario. El sistema está diseñado siguiendo el patrón "Transactional Outbox" para garantizar robustez, fiabilidad y escalabilidad.

---

## Componentes Principales

El sistema se compone de tres partes fundamentales que trabajan en conjunto:

1.  **La Base de Datos (PostgreSQL en Supabase):** Es el origen de todos los eventos. Utiliza tablas y *triggers* (disparadores automáticos) para registrar la necesidad de enviar una notificación.
2.  **La Edge Function `process-outbox` (Deno):** Es el motor del sistema. Un microservicio que se encarga de procesar las solicitudes de notificación y enviarlas al mundo exterior.
3.  **El Cliente (Navegador Web):** Es el receptor final. Incluye el código para suscribirse a las notificaciones y un Service Worker para recibirlas y mostrarlas.

---

## Flujo de Datos: Paso a Paso

Aquí se detalla el ciclo de vida de una notificación, por ejemplo, cuando se crea una nueva orden.

### Paso 1: Ocurre un Evento y se Activa un Trigger

Todo comienza con una acción en la base de datos. Por ejemplo, un cliente completa el formulario y se inserta una nueva fila en la tabla `orders`.

-   **Evento:** `INSERT` en la tabla `public.orders`.
-   **Acción:** Inmediatamente, el *trigger* de base de datos `notify_order_creation()` se dispara automáticamente.

Este trigger no intenta enviar la notificación directamente. En su lugar, su única responsabilidad es crear "trabajos" o "tareas" de notificación.

### Paso 2: Se Encola el Trabajo en la "Bandeja de Salida" (`notification_outbox`)

El trigger `notify_order_creation()` inserta dos filas en la tabla `public.notification_outbox`:

1.  **Para el Cliente:** Una fila con el `target_contact_id` o `target_user_id` del cliente, y un `payload` (el contenido del mensaje) como: `{ "title": "✅ Solicitud Recibida", "body": "Hemos recibido tu solicitud..." }`.
2.  **Para los Administradores:** Una fila con `target_role` establecido en `'administrador'`, y un `payload` como: `{ "title": "📢 Nueva Solicitud Recibida", "body": "Se ha creado la solicitud #..." }`.

La tabla `notification_outbox` actúa como una cola de tareas pendientes. Cada fila representa una notificación que debe ser enviada. La columna `processed_at` está en `NULL`, indicando que es un trabajo nuevo.

**Ventaja de este enfoque:** La creación de la orden es una transacción rapidísima y segura. No depende de servicios externos (como los servidores de notificaciones de Google o Apple), que podrían fallar y revertir la creación de la orden.

### Paso 3: La Edge Function `process-outbox` Entra en Acción

Esta función es la encargada de procesar la cola `notification_outbox`. Se activa de dos maneras:

-   **Invocación Inmediata (Webhook):** La base de datos está configurada para notificar a la URL de la función que hay un nuevo trabajo, lo que permite un envío casi instantáneo.
-   **Invocación Programada (Cron Job):** Cada minuto, un `pg_cron` en Supabase invoca la función para asegurarse de procesar cualquier trabajo que haya quedado pendiente por algún fallo.

Cuando la función se ejecuta:

1.  **Consulta la Cola:** Realiza una consulta a `notification_outbox` para obtener todas las filas donde `processed_at` es `NULL`.
2.  **Procesa Cada Trabajo (en paralelo):** Para cada trabajo pendiente, la función `processRow` realiza lo siguiente:
    *   **Identifica al Destinatario:** Lee el `target_user_id`, `target_contact_id` o `target_role` para saber a quién notificar. Si es un rol, busca a todos los usuarios que pertenecen a ese rol.
    *   **Busca las Suscripciones:** Con los IDs de los destinatarios, consulta la tabla `public.push_subscriptions`. Esta tabla contiene las "direcciones" únicas (`endpoint` y `keys`) que el navegador de cada usuario generó al aceptar recibir notificaciones.
    *   **Envía la Notificación Push:** Usando la librería `web-push` de Deno, envía el `payload` formateado a cada una de las suscripciones encontradas. La función se comunica con los servidores de los fabricantes de navegadores (ej. Google, Mozilla), quienes se encargan de "despertar" al Service Worker en el dispositivo del usuario.

### Paso 4: El Cliente Recibe y Muestra la Notificación

1.  **Recepción por el Service Worker (`sw.js`):** En el navegador del cliente, un script especial llamado Service Worker, que corre en segundo plano, recibe el evento `push`.
2.  **Muestra la Notificación:** El Service Worker extrae el título, cuerpo, icono y datos de la notificación y utiliza la API del navegador (`self.registration.showNotification()`) para mostrar la notificación nativa en el sistema operativo del usuario (Windows, macOS, Android, etc.).

### Paso 5: Persistencia y Limpieza

Después de enviar la notificación push, la función `process-outbox` realiza dos acciones finales:

1.  **Actualiza la Bandeja de Salida:** Marca el trabajo en `notification_outbox` estableciendo la fecha y hora en la columna `processed_at`. Esto asegura que el mismo trabajo no se procese dos veces.
2.  **Crea una Notificación en la App:** Inserta una fila en la tabla `public.notifications`. Esta es la notificación que el usuario ve dentro de la aplicación (por ejemplo, en un centro de notificaciones con un ícono de campana). Esto proporciona un historial persistente de las notificaciones enviadas.

---

## Cumplimiento de Estándares Deno y Web Push

-   **Entorno Deno:** La función `process-outbox` está escrita en TypeScript y se ejecuta en el entorno de Deno de Supabase. Utiliza las APIs y convenciones estándar de Deno, como `Deno.serve` para el servidor HTTP y `Deno.env.get()` para las variables de entorno.
-   **Librería `web-push` para Deno:** La función utiliza `deno.land/x/web_push@0.3.0`, una librería nativa de Deno que implementa correctamente el protocolo Web Push. Se encarga de la encriptación y la comunicación con los servidores de notificaciones (Push Services) de acuerdo con los estándares web actuales.
-   **Seguridad:** Las claves VAPID (Voluntary Application Server Identification), que son esenciales para autenticar al servidor de la aplicación, se gestionan de forma segura como secretos de entorno en Supabase.

En resumen, el sistema de notificaciones no solo es funcional, sino que también es **robusto, resiliente y está construido con tecnología moderna y estándares actuales**, asegurando que las notificaciones se entreguen de manera eficiente y fiable.
