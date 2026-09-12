# Gestor Mayorista

Tu "cerebro" de gestión por chat de Telegram: le contás lo que va pasando en el negocio (mercadería que entra, ventas, préstamos, prendas) y te responde con lo que necesites saber. Todo vive en un archivo de base de datos en tu PC (`data/gestor.db`), no depende de ningún servicio externo salvo Telegram y Claude.

## Qué maneja

- **Stock**: productos, cantidades, costo y precio de venta.
- **Empleados**: tus clientes mayoristas con "precio amigo" (descuento fijo).
- **Préstamos**: en pesos (ARS) o dólares (USD), con pagos parciales.
- **Prendas**: celulares u otros productos que alguien deja en pago o como garantía.

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

### 5. Configurar el `.env`

Copiá el archivo de ejemplo:

```bash
cp .env.example .env
```

Y completá `.env` con el token de Telegram, tu ID, y tu API key de Claude.

### 6. Arrancar

```bash
npm start
```

Si ves `Bot corriendo. Andá a Telegram y escribile.`, andá a Telegram, abrí el chat con tu bot y mandale `/start`.

Dejalo corriendo (la terminal abierta) mientras lo querés usar. Si cerrás la terminal, el bot deja de responder hasta que lo vuelvas a arrancar.

## Ejemplos de uso

- "Compré 10 iPhone 12 128GB a 300 dólares cada uno, para vender a 450"
- "Juan Pérez es empleado, dale 10% de descuento"
- "Vendí 2 iPhone 12 a Juan Pérez"
- "Le presté 500 dólares a María Gómez"
- "María me pagó 200"
- "María me dejó un Samsung S21 en garantía"
- "¿Cuánto stock tengo de iPhone 12?"
- "¿Cómo estamos en general?"
- "¿Qué me debe María?"

## Backups

La base de datos completa se respalda sola cada 6 horas en la carpeta `backups/` (se guardan los últimos 30). Para hacer un backup manual en cualquier momento:

```bash
npm run backup
```

Para restaurar uno viejo: cerrá el bot, reemplazá `data/gestor.db` por el archivo de `backups/` que quieras, y arrancá de nuevo.

## Panel web

Además del chat, hay un panel web para ver y editar todo (stock, ventas, préstamos, prendas, empleados) desde el navegador — de tu PC o de cualquier celu/compu conectado a la misma red wifi.

### Acceder

1. Con el bot corriendo (`npm start`), abrí en el navegador: **http://localhost:4000**
2. Desde otro dispositivo en la misma red (el celu, por ejemplo): necesitás la IP de tu PC en la red local.
   - En Windows: abrí PowerShell y corré `ipconfig`, buscá "Dirección IPv4" (algo como `192.168.0.15`).
   - Desde el celu, entrá a `http://192.168.0.15:4000` (con tu IP real).
3. Te va a pedir una clave — es el valor de `PANEL_PASSWORD` en tu `.env` (se generó uno automáticamente al armar el proyecto; podés cambiarlo cuando quieras, es un texto libre).

### Qué se puede hacer ahí

- **Resumen**: stock total, préstamos activos y prendas en depósito de un vistazo.
- **Stock**: cargar/sumar productos y editar cualquier campo (nombre, cantidad, costo, precio, nota) directo en la tabla.
- **Ventas**: filtrar por fecha, producto o cliente, con totales facturados y ganancia estimada.
- **Préstamos**: registrar préstamos nuevos y anotar pagos con un botón.
- **Prendas**: registrar y cambiar el estado (en prenda / devuelta / vendida).
- **Empleados**: agregar y ver la lista de precio amigo.

El panel y el chat de Telegram comparten exactamente la misma base de datos — lo que cargás en uno lo ves reflejado en el otro al instante.

> Importante: esto queda accesible para cualquiera conectado a tu wifi que tenga la clave. No lo expongas a internet (no hace falta nada especial para eso, simplemente no lo hagas). Si sospechás que alguien más tiene la clave, cambiá `PANEL_PASSWORD` en el `.env` y reiniciá.

## Sumar otro usuario autorizado

Por defecto el bot solo te escucha a vos (`OWNER_TELEGRAM_ID`). Si querés que otra persona de confianza (un socio, un empleado) también pueda usarlo:

1. Que esa persona busque **@userinfobot** en Telegram y te pase su ID numérico.
2. Agregalo en `.env`, en la variable `OTROS_TELEGRAM_IDS` (separado por coma si son varios):
   ```
   OTROS_TELEGRAM_IDS=111111111,222222222
   ```
3. Reiniciá el bot (`Ctrl+C` y `npm start` de nuevo).

Ojo: todos los usuarios autorizados comparten la misma base de datos — lo que registra uno lo ve (y puede modificar) el otro. Cada persona tiene su propio hilo de conversación con el bot (no se mezclan los mensajes de una persona con los de otra), pero los datos del negocio (stock, deudas, prendas) son un único set compartido, como corresponde.

## Notas

- El bot solo responde a los IDs de Telegram configurados en `.env` (nadie más puede usarlo aunque sepa el nombre de usuario).
- Si el bot no tiene claro un dato importante (por ejemplo, la moneda de un préstamo grande), te va a preguntar antes de registrar cualquier cosa.
- Todo lo que registrás queda guardado en `data/gestor.db` — ese archivo es tu negocio entero, tratalo con cuidado (por eso los backups automáticos).
