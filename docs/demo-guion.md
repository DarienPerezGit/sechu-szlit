# Guion de demo: SECHUB (5 minutos)

**Antes de empezar**
- Correr `pnpm seed:demo` contra el entorno de la demo, aunque sea el día anterior. Las fechas son relativas a hoy, así que el calendario siempre muestra audiencias próximas.
- Entrar una vez a la app antes de presentar. El plan Free de Supabase pausa el proyecto después de 7 días sin actividad.
- Usuario: `admin@sechub.test`.
- Plan B si falla la red: contingencia local (`docs/deployment-vercel.md` §6).

## 1. El problema (30 s)
"Un estudio laboral lleva la agenda, los legajos y las actas SECLO en planillas y mails sueltos. SECHUB lo junta todo en un solo lugar, y los casos se actualizan solos cuando llega un acta."

## 2. Carpetas (1 min), pestaña 📁 Carpetas
- Recorrer la lista: cada carpeta tiene un **estado** (En trámite, Conciliado, Desestimado) y un **sector** del pipeline (Comunicaciones → SECLO → Redacción → Procesal, más las verticales Accidentes y Mediaciones).
- Filtrar por sector **SECLO** y buscar "Textil".
- Abrir **Herrera c/ Distribuidora Oeste**: la bitácora muestra que un acta de desistimiento la pasó sola a *Desestimado*.

## 3. Calendario (1 min), pestaña 📅 Calendario
- Colores por tipo de audiencia: SECLO, judicial, accidente, mediación.
- Abrir el día de la audiencia **"Sin carpeta"** (17:00). Explicar que se puede bloquear una fecha antes de tener la carátula y vincularla después. Vincularla en vivo a *Sosa c/ Clínica San Jorge*.

## 4. El flujo central: un acta actualiza el caso (2 min), pestaña 📋 Actas
1. Hay **2 actas por vincular**, que llegaron de SECLO.
2. En el **Acuerdo, Expte. SECLO 207733/2026**, tocar **Vincular a carpeta**.
3. Mostrar que la app **sugiere sola la carpeta** (*Fernández c/ Textil Norte*) por el número de expediente, preselecciona la audiencia pendiente y avisa: *"La carpeta pasará a Conciliado"*.
4. Tocar **Vincular**. Se abre la carpeta con:
   - estado **Conciliado**
   - la audiencia **Realizada**
   - la bitácora: *"Acta vinculada · estado → conciliado"*, con usuario y hora
   - la versión incrementada
5. Remarcar que todo pasa en **una sola transacción**: si dos personas vinculan a la vez, una recibe "la carpeta cambió, recargá" y no se pisan.

## 5. Bajo el capó (30 s, si preguntan)
- Monolito Fastify + React en un solo dominio, sin CORS. Postgres en Supabase y autenticación con Supabase Auth (Bearer).
- Modelo listo para varios estudios (`estudio_id` en todas las tablas), permisos por rol y sector, bloqueo optimista con `version`.
- Migraciones versionadas, tests de API contra Postgres real, runbooks de backup y recuperación.

## Lo que viene
Liquidaciones con la normativa laboral (LCT, ley 25.323) y snapshot de parámetros, ficha de empleadores y checklist por carpeta.
