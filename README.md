# Gestor Mayorista

Tu "cerebro" de gestión por chat de Telegram: le contás lo que va pasando en el negocio (mercadería que entra, ventas, préstamos, canjes) y te responde con lo que necesites saber. La base de datos vive en **Turso** (un SQLite alojado en la nube, gratis para este uso), así que podés correrlo en tu PC o dejarlo desplegado en **Vercel** corriendo 24/7 — comparten los mismos datos.

## Qué maneja

- **Stock**: productos, cantidades, costo y precio de venta. La categoría se detecta sola con IA a partir del nombre.
- **Empleados**: tus clientes mayoristas con "precio amigo" (descuento fijo).
- **Préstamos**: en pesos (ARS) o dólares (USD), con pagos parciales.
- **Plan Canje**: trade-in de celulares — recibís un equipo a un precio, y queda una diferencia (en plata o producto) a favor tuyo o del cliente.

Vos le hablás normal ("vendí 2 iphone 12 a Juan", "cuánto me debe María", "che qué tengo en prenda") y él decide qué registrar o qué consultar.

## Puesta en marcha (una sola vez)

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear el bot de Telegram

1. Abrí Telegram y buscá **@BotFather**.
2. Mandale `/newbot`, ponele un nombre y un usuario (tiene que terminar en `bot`, ej. `mi_gestor_bot`).
3. Te va a dar un **token** (algo como `123456:ABC-DEF...`). Guardalo.

### 3. Conseguir tu ID de Telegram

1. Buscá **@userinfobot** en Telegram y mandale cualquier mensaje.
2. Te devuelve tu **ID** numérico. Guardalo — el bot solo va a responderte a vos, a nadie más.

### 4. Conseguir tu API key de Claude

1. Entrá a [console.anthropic.com](https://console.anthropic.com/), sección **API Keys**.
2. Creá una key nueva y guardala (solo se muestra una vez).

> Esto tiene costo por uso (se paga por mensaje, es centavos por interacción típica). No hace falta ningún plan de Claude.ai para esto, es la cuenta de API, aparte.

### 5. Crear la base de datos en Turso (gratis)

1. Entrá a [turso.tech](https://turso.tech) y creá una cuenta (podés entrar con GitHub).
2. Creá una base de datos nueva (un nombre cualquiera, ej `gestor-mayorista`).
3. Desde la página de esa base, copiá la **Database URL** (empieza con `libsql://...`).
4. Generá un **token de acceso** (botón tipo "Create Token" / "Generate Token") y copialo.

### 6. Configurar el `.env`

Copiá el archivo de ejemplo:

```bash
cp .env.example .env
```

Y completá `.env` con el token de Telegram, tu ID, tu API key de Claude, y la URL + token de Turso.

### 7. Arrancar

```bash
npm start
```

Si ves `Bot corriendo. Andá a Telegram y escribile.`, andá a Telegram, abrí el chat con tu bot y mandale `/start`.

Dejalo corriendo (la terminal abierta) mientras lo querés usar así, local. Si cerrás la terminal, el bot deja de responder hasta que lo vuelvas a arrancar — para que quede prendido todo el tiempo sin depender de tu PC, seguí con la sección de Vercel más abajo.

## Ejemplos de uso

- "Compré 10 iPhone 12 128GB a 300 dólares cada uno, para vender a 450"
- "Juan Pérez es empleado, dale 10% de descuento"
- "Vendí 2 iPhone 12 a Juan Pérez"
- "Le presté 500 dólares a María Gómez"
- "María me pagó 200"
- "Me trajeron un Samsung S21 en canje, lo tomo a 300 dólares"
- "Gonzalo me dio 300 de los 600 del canje" (pago en partes: te dice cuánto falta)
- "Agregame una nota: llamar al proveedor el lunes"
- "Pagué 300 mil de alquiler" o "Gasté 20 lucas en nafta" (gasto del negocio: se anota solo y va a la ganancia real y al flujo de caja)
- "¿Cuánto stock tengo de iPhone 12?"
- "¿Cómo estamos en general?"
- "¿Qué me debe María?"

## Desplegar en Vercel (para que quede prendido 24/7)

Corriendo solo en tu PC, el bot y el panel dejan de responder cuando la apagás. Para que quede siempre disponible sin depender de eso, se puede desplegar en **Vercel** (gratis) usando **Turso** como base de datos (que es lo que ya configuraste arriba — es la misma base tanto si corrés local como en Vercel).

### 1. Conectar el repo a Vercel

1. Entrá a [vercel.com](https://vercel.com), creá cuenta (podés con GitHub) y hacé **Add New → Project**.
2. Elegí el repo `gestor-mayorista-lucas` de GitHub.
3. En "Environment Variables" cargá **las mismas variables de tu `.env`** (todas, incluidas `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, las 4 del login con Google — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PANEL_EMAILS`, `PANEL_SESSION_SECRET`, ver "Login con Google" más abajo —, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `OTROS_TELEGRAM_IDS`, `TELEGRAM_WEBHOOK_SECRET` — no hace falta `PANEL_PORT`, Vercel maneja el puerto solo).
   > `TELEGRAM_WEBHOOK_SECRET` es **obligatoria** en Vercel: sin ella el webhook no procesa ningún mensaje (y te avisa por Telegram), porque cualquiera que conozca la URL podría mandarle mensajes falsos al bot haciéndose pasar por vos.
4. Deploy. Te va a quedar una URL tipo `https://gestor-mayorista-lucas.vercel.app`.

### 2. Activar el bot en modo webhook

Telegram tiene que saber que ahora te avisa a la URL de Vercel en vez de que el bot esté preguntando todo el rato (eso es lo que hacíamos local). Con tu `.env` local ya configurado (con el mismo `TELEGRAM_WEBHOOK_SECRET` que pusiste en Vercel), corré:

```bash
npm run set-webhook -- https://gestor-mayorista-lucas.vercel.app/api/telegram-webhook
```

Listo — a partir de ahí Telegram le habla directo a Vercel, y el panel también vive ahí: `https://gestor-mayorista-lucas.vercel.app`.

> Si alguna vez cambiás `TELEGRAM_WEBHOOK_SECRET`, tenés que volver a correr este comando con el valor nuevo en tu `.env`: Telegram manda esa clave en cada mensaje y, si no coincide con la de Vercel, el mensaje se rechaza.

### 3. Chequeo automático

Cada 30 minutos algo tiene que llamar a `/api/cron/verificar-webhook`: se fija que Telegram le siga mandando los mensajes al bot (si no, lo repone solo y te avisa) y borra registros viejos. En Logs se ve cuándo corrió por última vez.

Hay un respaldo en GitHub Actions (`.github/workflows/verificar-webhook.yml`), pero GitHub no respeta el horario: en la práctica corría cada 4 a 7 horas. El llamado principal se hace desde [cron-job.org](https://cron-job.org), que es gratis y puntual:

1. Creá una cuenta en cron-job.org y tocá **Create cronjob**.
2. **URL**: `https://gestor-mayorista-lucas.vercel.app/api/cron/verificar-webhook`
3. **Execution schedule**: cada 30 minutos.
4. En **Advanced → Headers** agregá uno: key `Authorization`, value `Bearer ` + el valor de `CRON_SECRET` (el mismo que está en Vercel, con un espacio después de `Bearer`).
5. Guardalo y tocá **Test run**: tiene que dar 200, y en Logs el chequeo pasa a "Chequeo automático OK · recién".

> Si en Vercel `CRON_SECRET` está marcada como *Sensitive* no se puede ver el valor. En ese caso inventá uno nuevo, cargalo en Vercel (y volvé a desplegar), en el secret `CRON_SECRET` del repo en GitHub y en cron-job.org.

### Volver a correr local (modo polling)

Si en algún momento querés volver a probarlo en tu PC con `npm start`, primero tenés que avisarle a Telegram que deje de mandarle los mensajes a Vercel:

```bash
npm run delete-webhook
npm start
```

Y cuando quieras que Vercel vuelva a hacerse cargo, repetís el paso de `set-webhook` de arriba.

## Backups

Los datos viven en Turso, que ya es un servicio en la nube durable por sí solo. Como respaldo extra, `npm start` (local) guarda cada 6 horas un volcado en JSON de toda la base en la carpeta `backups/` (se guardan los últimos 30). Para hacer uno manual en cualquier momento:

```bash
npm run backup
```

Si el bot corre en Vercel (donde no se pueden guardar archivos), podés bajar el mismo backup desde el panel: pestaña del bot → **Descargar backup**.

Restaurar un backup de estos es manual (mirar el JSON y volver a cargar lo que falte) — están pensados como red de contención para mirar a mano, no como restauración automática.

## Panel web

Además del chat, hay un panel web para ver y editar todo (stock, ventas, préstamos, plan canje, empleados) desde el navegador.

### Acceder

El panel está en **`/panel`**: la dirección principal es el catálogo para clientes (ver más abajo).

- **Corriendo local** (`npm start`, o `npm run panel` para levantar solo la web sin el bot): **http://localhost:4000/panel**, o desde el celu/otra compu en tu wifi con la IP de tu PC (`ipconfig` en Windows) en vez de `localhost`.
- **Desplegado en Vercel**: la URL que te dio Vercel con `/panel` al final (ej. `https://gestor-mayorista-lucas.vercel.app/panel`), accesible desde cualquier lado con internet.

En los dos casos se entra con una cuenta de Google. Pueden entrar los **dueños** (los mails de `PANEL_EMAILS`) y los **usuarios** que los dueños agregan desde la sección **Usuarios** del panel (Equipo y sistema), sin tocar Vercel. La sesión dura 30 días en cada dispositivo (o hasta tocar "Cerrar sesión").

### Login con Google

Se configura una sola vez:

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com) con tu cuenta y creá un proyecto (ej. "Gestor Mayorista").
2. **APIs y servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform"): tipo **Externo**, nombre de la app "Gestor Mayorista", tu mail de soporte. En **Público**, publicá la app ("En producción"). Solo pide mail y nombre, así que no hace falta que Google la revise; si la dejás "En prueba", agregá ahí como usuarios de prueba los mismos mails de `PANEL_EMAILS`.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo **Aplicación web**. En **Orígenes de JavaScript autorizados** agregá `https://gestor-mayorista-lucas.vercel.app` y, para probar en tu PC, `http://localhost:4000` (y el puerto que uses, ej. `http://localhost:3001`). No hace falta cargar "URIs de redireccionamiento".
4. Copiá el **ID de cliente** y el **Secreto del cliente** a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
5. En `PANEL_EMAILS` poné los mails de los **dueños**, separados por coma: entran siempre y son los únicos que ven la sección Usuarios, desde donde se suma al resto.
6. En `PANEL_SESSION_SECRET` poné una clave larga al azar. La generás con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
7. Cargá las 4 en tu `.env` y en las variables de Vercel, y volvé a desplegar.

Si falta alguna, el panel no deja entrar a nadie y la pantalla de login dice cuál falta (el bot sigue andando igual).

### Qué se puede hacer ahí

- **Resumen**: dashboards, con filtro de período (este mes, mes pasado, 3 meses, este año, 12 meses) y moneda (U$D o $; lo de la otra moneda se pasa al dólar blue del día). Cada gráfico se puede ver también como tabla.
  - **Ejecutivo**: facturación, ganancia bruta y margen (contra el período anterior), evolución de 12 meses, objetivos con la marca de dónde deberías estar hoy, proyección de cierre del mes y margen por categoría.
  - **Ventas**: cantidad de ventas, unidades, ticket promedio, clientes, el objetivo del mes día a día contra el mes pasado y el ritmo ideal, objetivo vs. cumplimiento de los últimos 6 meses, ranking de productos más vendidos y ventas por categoría.
  - **Financiero**: ingresos, gastos, ganancia real (ganancia bruta menos gastos), flujo de caja (entra: ventas y cobros de préstamos; sale: compras de mercadería, gastos y préstamos dados), de las ventas a la ganancia real, gastos por categoría, lo que tenés hoy en stock y por cobrar, y la lista de gastos.
  - **Objetivos**: se cargan con "Editar" (facturación, ganancia y unidades por mes) y valen desde ese mes hasta que cargues otros. **Gastos**: con "Registrar gasto" o por Telegram.
- **Stock**: cargar productos (con botón "Agregar stock") y editar cualquier campo con el lápiz de cada fila. Los celulares tienen **Estado** (Sellado, Usado - como nuevo o Usado) y, si no son sellados, **Batería (%)**: el % se agrega solo al nombre (ej. "iPhone 15 Pro 128GB 85%"), así cada usado con su batería queda como un producto aparte.
- **Ventas**: cargar una venta nueva, filtrar por fecha/producto/cliente, con totales facturados y ganancia estimada.
- **Préstamos**: registrar préstamos nuevos y anotar pagos con un botón.
- **Plan Canje**: registrar un trade-in (celular recibido, precio, y la diferencia en plata o producto a favor tuyo o del cliente). Si la diferencia en plata se paga en partes (ej. U$D 600 en dos meses), con "Cobrar" (o "Pagar", si sos vos el que debe) se carga cada parte con su fecha: la tabla muestra cuánto falta con una barra de lo pagado, y el canje queda saldado solo cuando se completa. Los pagos mal cargados se borran desde el mismo lugar.
- **Notas**: notas sueltas tipo post-it (recordatorios, pendientes, datos). Se guardan solas mientras escribís; se pueden pintar de colores, fijar arriba, buscar y borrar. También se agregan por Telegram ("agregame una nota: …").
- **Empleados**: agregar y ver la lista de precio amigo.
- **Logs**: qué está pasando en todo el sistema, para ver qué falla sin entrar a Vercel.
  - **Sistema**: errores y avisos del bot, la IA, las herramientas (ej: "no existe ese producto"), el panel (pedidos rechazados o lentos), Telegram, el chequeo automático, la cotización del dólar, quién entró al panel y los intentos con cuentas de Google no autorizadas, la gente sin acceso que le escribe al bot y los errores de la página en el navegador. Cada evento tiene su detalle técnico para copiar. Arriba: si anda todo bien, cuántos errores y avisos hubo, el último chequeo automático, y en qué parte pasa más.
  - **Conversaciones del bot**: qué le escribieron, qué contestó, qué herramientas usó y cuánto tardó.
  - Filtros por período (24 h, 7 o 30 días), nivel, origen y búsqueda; "En vivo" actualiza solo cada 20 segundos. Lo informativo se guarda 2 semanas y los avisos y errores, 2 meses.

El panel y el chat de Telegram comparten exactamente la misma base de datos (Turso) — lo que cargás en uno lo ves reflejado en el otro al instante, corra donde corra cada uno.

> Importante: quien entre al panel puede ver y editar todos tus datos, así que agregá solo cuentas de confianza. Para sacarle el acceso a un usuario, tocá el tacho en **Usuarios**: su sesión deja de valer en menos de un minuto. A un dueño se lo saca borrando su mail de `PANEL_EMAILS` y volviendo a desplegar. Para que entren mails nuevos sin cargarlos uno por uno en Google, la app de Google tiene que estar publicada ("En producción", paso 2). Para cerrar la sesión de todos de golpe (ej. si perdiste el celu), cambiá `PANEL_SESSION_SECRET`. Cada entrada queda anotada en Logs (con el mail), igual que los intentos con cuentas no autorizadas.

## Catálogo para clientes

La dirección principal (ej. `https://gestor-mayorista-lucas.vercel.app`) es un catálogo público, para pasarle a los clientes: buscador, pestañas por categoría, filtros desplegables y tarjetas con el precio "desde". En los celulares se filtra por marca y, elegida la marca, por modelo (con el precio "desde" de cada uno); la marca y el modelo se leen solos del nombre de la publicación (ej. "Samsung Galaxy S24 Ultra" → Samsung, Galaxy S24 Ultra). Si salen mal, o para darle marca a algo que no es un celular (ej. vapers: Ignite → V150), se cargan a mano en los campos Marca y Modelo de la publicación, en el panel; mientras están vacíos muestran lo que el sistema detectó solo. También se filtra por estado (Sellado / Usado) y se ordena por precio o nombre. Al tocar un producto se abre su ficha, donde el cliente elige memoria, color y batería y consulta por WhatsApp con el mensaje ya armado. Cada ficha tiene su propio link (ej. `.../#p-3`) para pasarlo directo. No muestra costos, notas internas ni el stock.

- El catálogo va **aparte del stock**: son "publicaciones" que se manejan desde el panel, en la sección **Catálogo** (nombre, estado, memorias con su precio, si lo tenés o no, si se muestra o no, y el orden). La primera vez se arma solo con lo que haya en stock.
- **Estado**: Sellado, Usado - como nuevo o Usado. En los usados, el cliente elige entre los equipos de ese modelo que tengas en stock según la batería: se toman los campos Estado y Batería de cada equipo en Stock (una publicación "Usado - como nuevo" muestra solo los como nuevo), con su precio de venta, y cuando uno se vende desaparece solo.
- **Visible** apagado saca una publicación de la vista de los clientes sin borrarla; **Lo tengo** apagado la muestra como "sin stock". Por Telegram podés pedirle al bot que saque o vuelva a mostrar una publicación ("sacá el iPhone 15 Pro del catálogo"): solo la oculta, nunca la borra.
- Las fotos se cargan en la misma sección: una por modelo y color. Cada publicación muestra las fotos de su modelo con puntitos de color para cambiar entre ellas.
- El número de WhatsApp de los botones sale de la variable `CATALOGO_WHATSAPP` (con código de país, ej. `5491112345678`).

## Sumar otro usuario autorizado

Por defecto el bot solo te escucha a vos (`OWNER_TELEGRAM_ID`). Si querés que otra persona de confianza (un socio, un empleado) también pueda usarlo:

1. Que esa persona busque **@userinfobot** en Telegram y te pase su ID numérico.
2. Agregalo en `.env`, en la variable `OTROS_TELEGRAM_IDS` (separado por coma si son varios):
   ```
   OTROS_TELEGRAM_IDS=111111111,222222222
   ```
3. Reiniciá el bot (`Ctrl+C` y `npm start` de nuevo).

Ojo: todos los usuarios autorizados comparten la misma base de datos — lo que registra uno lo ve (y puede modificar) el otro. Cada persona tiene su propio hilo de conversación con el bot (no se mezclan los mensajes de una persona con los de otra), pero los datos del negocio (stock, deudas, canjes) son un único set compartido, como corresponde.

## Notas

- El bot solo responde a los IDs de Telegram configurados en `.env` / Vercel (nadie más puede usarlo aunque sepa el nombre de usuario).
- Si el bot no tiene claro un dato importante (por ejemplo, la moneda de un préstamo grande), te va a preguntar antes de registrar cualquier cosa.
- Todo lo que registrás queda guardado en Turso — esa base es tu negocio entero, tratala con cuidado (por eso los backups en JSON).
- El bot solo puede estar en un modo a la vez: **local con polling** (`npm start`) o **Vercel con webhook**. Si tenés el webhook activo y corrés `npm start`, el bot te va a avisar que primero corras `npm run delete-webhook`.
