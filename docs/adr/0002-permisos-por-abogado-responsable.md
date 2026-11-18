# ADR 0002: Permisos por abogado responsable (titular, abogado, asistente)

**Estado:** aceptado · 2026-11-18 · reemplaza el modelo del ticket 5 (`docs/archive/prd/ticket-5-permisos-rol-sector.md`)

## Contexto

El ticket 5 repartió los permisos por **sector del pipeline**: `admin`, `responsable_sector` (escribe en las carpetas de sus sectores) y `lectura`. El diseño salió de convertir el pipeline (Comunicaciones → SECLO → Redacción → Procesal) en un permiso, sin validarlo con el estudio.

En un estudio laboral el trabajo no se reparte así:

- cada expediente tiene un **abogado responsable**;
- la procuración (agendar, cargar actas) la hace un **asistente** que ve todo pero no conduce el caso;
- el **titular** es un abogado más, con permiso para ver todo y administrar el equipo.

El prototipo que aportó el propio estudio (`docs/design/prototipo-szlit.html`) ya lo modelaba de este modo: un titular con permiso `admin`, abogados con permiso `usuario`, un botón "Hacer admin" y cada audiencia con su `abogadoId`. Además, "lectura" no corresponde a ningún puesto real, y en el modelo viejo todos los usuarios leían todas las carpetas.

## Decisión

| Perfil | Cómo se guarda | Qué ve y qué hace |
|---|---|---|
| Abogado | rol `abogado` | Solo sus carpetas (`carpetas.abogado_responsable_id`) y su agenda. Abre carpetas a su nombre y las modifica. |
| Asistente (procuración) | rol `asistente` | Ve todo el estudio. Agenda audiencias, carga y vincula actas. No abre ni edita carpetas. |
| Titular | rol `abogado` + `usuarios.es_titular` | Ve y modifica todo, reasigna carpetas y es el único que administra el equipo (`PATCH /api/equipo/:id`). |

- **El titular no es un tercer rol**, es un abogado con un permiso extra. Un estudio puede tener varios, y nunca puede quedar sin titular activo.
- **El sector deja de ser un permiso.** Sigue siendo la etapa del pipeline de cada carpeta y un filtro de trabajo.
- **Vincular un acta es procuración.** El asistente puede hacerlo aunque cambie el estado del caso, porque ese cambio es el efecto automático del acta y no una edición manual del expediente.
- La matriz vive en un solo módulo (`apps/api/src/authorization.ts`) y las rutas llaman a sus políticas. La regla central es `actuaSoloSobreLoPropio = rol abogado && !es_titular`.
- El rol se lee de la base en cada pedido, así que un cambio de rol, de titularidad o una baja aplica en el pedido siguiente.
- Orden de chequeos: autenticación (401) → rol (403) → cuerpo (400) → existencia (404) → acceso al recurso (403).

## Consecuencias

- Migración `0011_roles_titular_abogado_asistente.sql`:
  - convierte `admin` en titular y `responsable_sector` en abogado;
  - deja **sin rol y desactivado** a quien solo tenía `lectura`: pasarlo a asistente le daría permisos que nunca tuvo (agendar y vincular actas, que cambia el estado del caso). El titular decide a mano qué perfil le corresponde;
  - asigna las carpetas existentes al titular;
  - fija un rol por usuario y elimina `usuarios_sectores`.
- El abogado común deja de ver las carpetas ajenas. Si consulta una por id recibe 403, no 404, porque la existencia se valida antes que el acceso.
- Los honorarios del modelo de referencia no aplican todavía: SECHUB no los gestiona.
- Antes de aplicar la 0011 en producción: dump de la base (`docs/supabase-backup-restore.md`). Después, en la misma ventana, migración y merge, porque código y base tienen que cambiar juntos.
- Queda pendiente una pantalla de administración del equipo. La API ya existe y la prueba `permisos.test.ts` la cubre.
