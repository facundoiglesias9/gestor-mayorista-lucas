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
- "¿Cuánto stock tengo de iPhone 12?"
- "¿Cómo estamos en general?"
- "¿Qué me debe María?"

## Desplegar en Vercel (para que quede prendido 24/7)

Corriendo solo en tu PC, el bot y el panel dejan de responder cuando la apagás. Para que quede siempre disponible sin depender de eso, se puede desplegar en **Vercel** (gratis) usando **Turso** como base de datos (que es lo que ya configuraste arriba — es la misma base tanto si corrés local como en Vercel).

### 1. Conectar el repo a Vercel

1. Entrá a [vercel.com](https://vercel.com), creá cuenta (podés con GitHub) y hacé **Add New → Project**.
2. Elegí el repo `gestor-mayorista-lucas` de GitHub.
3. En "Environment Variables" cargá **las mismas variables de tu `.env`** (todas, incluidas `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PANEL_PASSWORD`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `OTROS_TELEGRAM_IDS`, `TELEGRAM_WEBHOOK_SECRET` — no hace falta `PANEL_PORT`, Vercel maneja el puerto solo).
4. Deploy. Te va a quedar una URL tipo `https://gestor-mayorista-lucas.vercel.app`.

### 2. Activar el bot en modo webhook

Telegram tiene que saber que ahora te avisa a la URL de Vercel en vez de que el bot esté preguntando todo el rato (eso es lo que hacíamos local). Con tu `.env` local ya configurado (con el mismo `TELEGRAM_WEBHOOK_SECRET` que pusiste en Vercel), corré:

```bash
npm run set-webhook -- https://gestor-mayorista-lucas.vercel.app/api/telegram-webhook
```

Listo — a partir de ahí Telegram le habla directo a Vercel, y el panel también vive ahí: `https://gestor-mayorista-lucas.vercel.app`.

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

Restaurar un backup de estos es manual (mirar el JSON y volver a cargar lo que falte) — están pensados como red de contención para mirar a mano, no como restauración automática.

## Panel web

Además del chat, hay un panel web para ver y editar todo (stock, ventas, préstamos, plan canje, empleados) desde el navegador.

### Acceder

- **Corriendo local** (`npm start`): **http://localhost:4000**, o desde el celu/otra compu en tu wifi con la IP de tu PC (`ipconfig` en Windows) en vez de `localhost`.
- **Desplegado en Vercel**: la URL que te dio Vercel (ej. `https://gestor-mayorista-lucas.vercel.app`), accesible desde cualquier lado con internet.

En los dos casos te va a pedir una clave — es el valor de `PANEL_PASSWORD` (en tu `.env` local, o en las variables de entorno de Vercel).

### Qué se puede hacer ahí

- **Resumen**: stock total, préstamos activos y canjes pendientes de un vistazo.
- **Stock**: cargar productos (con botón "Agregar stock") y editar cualquier campo con el lápiz de cada fila.
- **Ventas**: cargar una venta nueva, filtrar por fecha/producto/cliente, con totales facturados y ganancia estimada.
- **Préstamos**: registrar préstamos nuevos y anotar pagos con un botón.
- **Plan Canje**: registrar un trade-in (celular recibido, precio, y la diferencia en plata o producto a favor tuyo o del cliente) y marcarlo saldado cuando se resuelve.
- **Empleados**: agregar y ver la lista de precio amigo.

El panel y el chat de Telegram comparten exactamente la misma base de datos (Turso) — lo que cargás en uno lo ves reflejado en el otro al instante, corra donde corra cada uno.

> Importante: quien tenga la clave del panel puede ver y editar todos tus datos. Si lo desplegás en Vercel queda accesible desde cualquier internet — la única traba es esa clave, así que elegí una que no sea obvia y no la compartas. Si sospechás que alguien más la tiene, cambiá `PANEL_PASSWORD` (en tu `.env` y/o en Vercel) y volvé a desplegar/reiniciar.

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
