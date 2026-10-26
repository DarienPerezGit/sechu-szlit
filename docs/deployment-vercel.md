# Despliegue en Vercel Hobby y Contingencia Académica

Este documento define la arquitectura de despliegue, configuración de entorno, verificación de smoke test y contingencia de presentación local para el sistema **SECHUB (Estudio Jurídico Szlit & Asociados)**.

---

> [!IMPORTANT]
> **Alcance del Hosting Vercel Hobby**:
> El plan Vercel Hobby se utiliza **exclusivamente con fines académicos, personales y de evaluación de seminario/tesina universitaria**, sin fines de lucro ni actividad comercial.
> Para la operación comercial o productiva de un estudio jurídico real, la infraestructura debe migrarse a Vercel Pro o a un entorno de contenedores dedicado (Docker/Kubernetes en VPS o nube corporativa).

---

## 1. Arquitectura de Despliegue (Single Origin)

El proyecto se despliega como una única unidad bajo el mismo dominio de Vercel:

1. **Frontend Estático (SPA Vite)**:
   - Se compila en `apps/web/dist`.
   - Vercel sirve los archivos estáticos (`/assets/*`, `index.html`) directamente desde su CDN global.
   - Las rutas del cliente (SPA) redirigen a `/index.html` mediante la regla de rewrite en `vercel.json`.

2. **Backend Serverless (Fastify)**:
   - Punto de entrada oficial de Vercel Functions: [`api/index.ts`](../api/index.ts).
   - Recibe las peticiones dirigidas a `/api/*` y despacha el ciclo de vida HTTP directamente al servidor Fastify (`app.server.emit('request', req, res)`).
   - Incluye endpoint de diagnóstico rápido: `GET /api/health`.

3. **Origen Compartido**:
   - Al compartir el mismo origen (ej. `https://sechub.vercel.app`), las peticiones del frontend a `/api/*` son relativas, eliminando problemas de CORS, cookies de terceros o desincronización de URLs.

---

## 2. Separación de Variables de Entorno

Para proteger la integridad de los datos y evitar fugas de secretos administrativos, las variables se dividen estrictamente en dos categorías:

### A. Variables de Runtime en Vercel (Configuración del Proyecto)
Estas variables se configuran en **Vercel Project Settings → Environment Variables**:

| Variable | Ámbito | Descripción |
|---|---|---|
| `DATABASE_URL` | Serverless Function | Cadena de conexión al **Transaction Pooler de Supabase** (puerto 6543 o 5432 pooler). Formato: `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | Serverless + Web | URL del proyecto Supabase (ej: `https://[ref].supabase.co`). |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Serverless Function | Llave anónima pública utilizada para validar tokens Bearer en Fastify. |
| `VITE_SUPABASE_URL` | Frontend Build | Exposición pública para el cliente Supabase del navegador. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend Build | Llave anónima pública para el cliente del navegador. |
| `NODE_ENV` | Global | `production` |

### B. Variables Administrativas (NUNCA en Vercel Runtime)
Estas variables se conservan **únicamente en CI/CD (GitHub Secrets) o entornos locales autorizados**:

| Variable | Prohibida en Vercel | Motivo de Seguridad |
|---|---|---|
| `MIGRATION_DATABASE_URL` | ❌ Sí | Conexión directa a PostgreSQL (puerto 5432 directo `db.[ref].supabase.co`) con permisos DDL. Las funciones serverless nunca deben tener permisos para alterar esquemas. |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ Sí | Secret con privilegios totales de bypass RLS y administración de usuarios. |
| `TEST_DATABASE_URL` | ❌ Sí | Base de datos local/CI para testing automatizado. |

---

## 3. Reglas de Ejecución y Base de Datos

1. **Sin migraciones en el arranque**: Fastify **no** ejecuta migraciones DDL al inicializarse (`app.ready()` solo monta rutas y plugins). Las migraciones se aplican previamente mediante `pnpm db:migrate` desde CI o terminal administrativa.
2. **Uso obligatorio del Pooler**: Debido a la naturaleza efímera y concurrente de las Vercel Serverless Functions, `DATABASE_URL` debe apuntar al Connection Pooler (Supavisor) de Supabase para evitar el agotamiento de conexiones (Max Connections limit).

---

## 4. Datos de Prueba para la Presentación (Fictional Seeds)

Para la demostración académica y smoke tests en vivo, se cuenta con dos usuarios ficticios precargados en Supabase Auth y sincronizados con `public.usuarios`:

- **Administrador**:
  - Email: `admin@sechub.test`
  - Contraseña: `DevOnly-Admin-2024!`
  - Rol: `ADMIN` (acceso a todos los sectores y parametrizaciones).
- **Lectura / Visualizador**:
  - Email: `viewer@sechub.test`
  - Contraseña: `DevOnly-Viewer-2024!`
  - Rol: `LECTURA` (sin privilegios de escritura).

Estos usuarios se generan ejecutando el script [`packages/db/src/seeds/seed-dev-users.sql`](../packages/db/src/seeds/seed-dev-users.sql) contra Supabase.

---

## 5. Smoke Test Automatizado

Se incluye un script automatizado para verificar el despliegue en Vercel o en local:

```bash
# Ejecutar contra el despliegue de Vercel:
TARGET_URL=https://tu-proyecto.vercel.app \
SUPABASE_URL=https://[ref].supabase.co \
SUPABASE_PUBLISHABLE_KEY=[anon-key] \
pnpm smoke
```

El script verifica:
1. `GET /api/health` retorna status 200 OK.
2. Peticiones sin token a `/api/auth/me` son rechazadas con 401 Unauthorized.
3. Tokens inválidos o alterados son rechazados con 401 Unauthorized.
4. Autenticación exitosa del usuario de presentación vía Supabase Auth.
5. Consulta autenticada de perfil `/api/auth/me` y catálogo `/api/catalogos`.

---

## 6. Procedimiento de Contingencia Local (Fallback Académico)

En caso de corte de Internet, falla de conectividad con Vercel o problemas de red durante la defensa o exposición:

### Paso 1: Levantar infraestructura local en Docker
```bash
# Iniciar contenedor PostgreSQL 18
pnpm docker:up
```

### Paso 2: Configurar entorno local de contingencia
Verificar que `.env.local` apunte a la base de datos local:
```env
DATABASE_URL=postgresql://sechub:sechub@localhost:5432/sechub
MIGRATION_DATABASE_URL=postgresql://sechub:sechub@localhost:5432/sechub
```

### Paso 3: Aplicar migraciones y compilar
```bash
pnpm db:migrate
pnpm build
```

### Paso 4: Iniciar la aplicación
```bash
# Iniciar servidor backend y frontend local
pnpm --filter api start
```
La aplicación quedará operativa inmediatamente en `http://localhost:3000`.

### Paso 5: Restauración de Supabase (si aplica)
Si la base remota sufriera alguna alteración indeseada previa a la presentación, seguir el procedimiento de restauración documentado en [`docs/supabase-backup-restore.md`](./supabase-backup-restore.md).
