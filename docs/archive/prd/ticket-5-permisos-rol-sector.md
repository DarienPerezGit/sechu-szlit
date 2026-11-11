# PRD - Ticket 5: Permisos por rol y sector

## Problem Statement

El sistema requiere un control de accesos granular para evitar que los usuarios realicen modificaciones no autorizadas sobre expedientes (carpetas) y audiencias fuera de su competencia. Actualmente, todos los usuarios autenticados pueden crear y editar cualquier carpeta o audiencia. Se necesita un sistema jerárquico donde los administradores tengan control total, los responsables de sector tengan control limitado a sus sectores asignados, y los usuarios con rol de lectura solo puedan consultar información sin realizar cambios.

## Solution

1. Modelar e implementar en la base de datos las tablas `roles`, `usuarios_roles` y `usuarios_sectores` para representar los permisos y la pertenencia a los sectores del pipeline de los usuarios.
2. Crear un middleware de autorización a nivel API que verifique el rol del usuario y sus sectores asociados en cada petición de escritura.
3. Aplicar las siguientes reglas de negocio:
   * **Administrador (`admin`):** Acceso total de lectura y escritura.
   * **Responsable de Sector (`responsable_sector`):** Lectura total. Escritura permitida únicamente sobre carpetas y audiencias cuyo `sector_actual_id` pertenezca a los sectores asignados al usuario en `usuarios_sectores`.
   * **Lectura (`lectura`):** Lectura total. Escritura denegada en todos los endpoints sin excepciones.
   * **Transición de sector:** La modificación del sector de una carpeta (`sector_actual_id`) solo está permitida si el usuario es responsable del sector de origen (actual) de dicha carpeta.
   * **Audiencias Huérfanas (`carpeta_id` es NULL):** Son editables por administradores y responsables de sector sin restricción de sector (ya que no tienen carpeta asociada), pero siguen estando bloqueadas para usuarios de rol `lectura`.
4. Retornar error HTTP `403 Forbidden` ante cualquier violación de permisos.

## User Stories

1. As an authenticated administrator, I want to create, read, and edit all carpetas and audiencias, so that I have unrestricted control over the system's data.
2. As a sector manager (responsable_sector), I want to view all carpetas and audiencias in the system, so that I can maintain overall situational awareness.
3. As a sector manager (responsable_sector), I want to edit only carpetas whose current sector is assigned to me, so that I do not modify cases from other sectors.
4. As a sector manager (responsable_sector), I want to edit only audiencias linked to carpetas whose current sector is assigned to me, so that I only manage appointments relevant to my area.
5. As a sector manager (responsable_sector) or administrator, I want to create and edit orphan audiencias (without associated folders), so that they can be scheduled and updated before a folder exists.
6. As a read-only user (lectura), I want to view all carpetas and audiencias, so that I can inspect cases without risking accidental modifications.
7. As a read-only user (lectura), I want to be blocked from creating or modifying any carpetas, linked audiencias, or orphan audiencias, so that data integrity is protected.
8. As a sector manager (responsable_sector), I want to transition a carpeta to a different sector only if I am responsible for its current sector, so that cases are moved through the pipeline only by authorized personnel.
9. As any user, I want unauthorized actions to return a 403 Forbidden response, so that I am clearly informed when an action exceeds my privileges.

## Implementation Decisions

### 1. Database Changes (`packages/db/`)
* **Tabla `roles`**:
  * `id`: serial PK.
  * `codigo`: varchar(100) (`UNIQUE`, `NOT NULL`).
  * `nombre`: varchar(255) (`NOT NULL`).
* **Tabla `usuarios_roles`**:
  * `usuarioId`: UUID (FK a `usuarios(id)`, `NOT NULL`).
  * `rolId`: integer (FK a `roles(id)`, `NOT NULL`).
  * Clave primaria compuesta (`usuarioId`, `rolId`).
* **Tabla `usuarios_sectores`**:
  * `usuarioId`: UUID (FK a `usuarios(id)`, `NOT NULL`).
  * `sectorId`: integer (FK a `sectores(id)`, `NOT NULL`).
  * Clave primaria compuesta (`usuarioId`, `sectorId`).
* **Semillas (Seeds)**:
  * Cargar roles de manera idempotente: `'admin'` (Administrador), `'responsable_sector'` (Responsable de Sector), `'lectura'` (Lectura).

### 2. API Authorization Middleware (`apps/api/`)
* **Carga de Roles y Sectores**:
  * El middleware/decorador de autorización leerá las asociaciones de roles y sectores del usuario autenticado basándose en su sesión activa.
* **Reglas de Acceso**:
  * `admin` pasa todas las validaciones.
  * `lectura` falla con `403` en cualquier método de escritura (POST, PATCH, DELETE).
  * `responsable_sector` pasa en métodos GET.
  * En peticiones de escritura (`POST /api/carpetas`, `PATCH /api/carpetas/:id`):
    * Para creación, el `sectorActualId` especificado en el cuerpo debe estar en la lista de sectores del usuario.
    * Para modificación, el `sectorActualId` de la carpeta actual en la base de datos debe estar en la lista de sectores del usuario.
    * Si la modificación cambia el `sectorActualId` (transición de sector), el sector actual (origen) debe estar en la lista de sectores del usuario. El sector destino no requiere validación para permitir la delegación de tareas hacia adelante en el pipeline.
  * En peticiones de modificación de audiencias (`PATCH /api/audiencias/:id` o `/vincular`):
    * Si la audiencia tiene `carpetaId` asociado, se comprueba si el sector de esa carpeta está en los sectores asignados al usuario.
    * Si la audiencia tiene `carpetaId` en `NULL` (huérfana), se permite la edición para cualquier responsable de sector (sin validar sector).

## Testing Decisions

* **Pruebas de Base de Datos (`packages/db/tests/roles.test.ts`)**:
  * Validar las PK compuestas en `usuarios_roles` y `usuarios_sectores` y las claves foráneas hacia `usuarios`, `roles` y `sectores`.
  * Verificar que el seed inicial inserte los tres roles obligatorios.
* **Pruebas de API (`apps/api/tests/permisos.test.ts`)**:
  * Validar acceso total de `admin`.
  * Validar bloqueo de escrituras de `lectura` (retorno de `403`) en carpetas, audiencias vinculadas y audiencias huérfanas.
  * Validar que un `responsable_sector` solo edite carpetas de sus sectores.
  * Validar que un `responsable_sector` reciba `403` al intentar editar carpetas de otros sectores.
  * Validar que un `responsable_sector` pueda transicionar una carpeta de sector solo si tiene permisos sobre el sector de origen.
  * Validar que un `responsable_sector` pueda editar audiencias huérfanas y que estas pasen a aplicar las reglas del sector correspondiente una vez que se vinculen a una carpeta.

## Out of Scope

* Acciones administrativas avanzadas de "reclamar carpeta" para forzar transiciones de sector por parte de no responsables (a definir con el cliente).
* Interfaz de usuario para la gestión o asignación de roles y sectores a los usuarios.

## Implementation Note

No se agregó un `PATCH /api/audiencias/:id` genérico porque no existe una ruta pública actual que lo requiera. Las reglas se aplican a los endpoints de escritura existentes: `POST /api/audiencias` valida el sector de una carpeta cuando la audiencia nace vinculada y `PATCH /api/audiencias/:id/vincular` aplica la regla según el estado actual de la audiencia. Una audiencia huérfana puede vincularse por cualquier responsable de sector; una vez vinculada, futuros intentos de escritura sobre esa audiencia requieren responsabilidad sobre el sector actual de su carpeta.

## Further Notes

Ninguna.
