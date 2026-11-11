# PRD - Ticket 4: Audiencias con orphan tray

## Problem Statement

El equipo de abogados del estudio jurídico Szlit necesita registrar y organizar las audiencias del día para evitar vencimientos y faltas a citaciones. En ocasiones, reciben notificaciones de audiencias (por ejemplo, vía mail o de manera urgente) antes de que la carpeta del caso esté completamente cargada en el sistema. Los usuarios necesitan poder asentar la audiencia inmediatamente para que figure en la agenda, y luego asociarla a la carpeta correspondiente una vez que esta se cree.

## Solution

1. Extender el modelo de base de datos para soportar una tabla de `audiencias` con una relación opcional (`nullable`) a `carpetas`.
2. Habilitar una "Bandeja de Huérfanas" (*Orphan Tray*) que liste todas las audiencias registradas que no tienen una carpeta asociada.
3. Proveer endpoints en la API para:
   * Crear audiencias (con o sin carpeta asociada).
   * Obtener la agenda del día (con detalles del caso, abogado asignado y tipo de audiencia).
   * Obtener las audiencias huérfanas.
   * Vincular una audiencia huérfana a una carpeta existente, registrando automáticamente esta acción en la bitácora del legajo.
4. Asegurar el aislamiento multi-tenant por `estudio_id` en todas las operaciones.

## User Stories

1. Como abogado del estudio, quiero registrar una audiencia directamente asociada a una carpeta existente, para que el legajo del caso esté completo.
2. Como abogado del estudio, quiero registrar una audiencia sin asociarla a ninguna carpeta, para asentar la fecha y hora inmediatamente sin esperar la creación del legajo.
3. Como abogado del estudio, quiero ver la agenda de audiencias de un día específico ordenada cronológicamente por hora, para planificar mi jornada de trabajo.
4. Como abogado del estudio, quiero ver en la agenda los detalles de la carátula de la carpeta, el abogado asignado y el color del tipo de audiencia, para identificar rápidamente de qué caso se trata.
5. Como abogado del estudio, quiero ver la bandeja de huérfanas, para identificar fácilmente qué audiencias aún no han sido asignadas a sus respectivas carpetas.
6. Como abogado del estudio, quiero vincular una audiencia huérfana a una carpeta existente, para que quede asignada al legajo correcto del caso.
7. Como administrador del estudio, quiero que al vincular una audiencia huérfana a una carpeta se genere una entrada automática en la bitácora de la carpeta, para mantener el historial de auditoría completo.
8. Como administrador del estudio, quiero que todas mis consultas y escrituras de audiencias estén aisladas a mi estudio, para evitar fugas de información hacia otros inquilinos (cross-tenant).

## Implementation Decisions

### 1. Cambios en Base de Datos (`packages/db/`)
* **Tabla `audiencias`**:
  * `id`: UUIDv7 PK.
  * `estudio_id`: UUID (FK a `estudios`, `NOT NULL`).
  * `carpeta_id`: UUID (FK a `carpetas`, `nullable`).
  * `abogado_id`: UUID (FK a `usuarios`, `NOT NULL`).
  * `fecha`: tipo `date` (`NOT NULL`).
  * `hora`: tipo `time` (`NOT NULL`).
  * `tipo_audiencia_id`: Integer (FK a `tipos_audiencia`, `NOT NULL`).
  * `link_reunion`: tipo `text` (`nullable`).
  * `link_detalle`: tipo `text` (`nullable`).
  * `notas_internas`: tipo `text` (`nullable`).
  * `created_at` y `updated_at` (timestamps con zona horaria).
* **Índices**:
  * Índice compuesto que inicie por `estudio_id` (por ejemplo, `(estudio_id, fecha, hora)` y `(estudio_id, carpeta_id)`).

### 2. Endpoints de la API (`apps/api/`)
* **`POST /api/audiencias`**:
  * Crea una audiencia. Valida la existencia del `abogado_id` y `tipo_audiencia_id` (y opcionalmente `carpeta_id`), asegurándose de que pertenezcan al mismo `estudio_id` del usuario autenticado.
* **`GET /api/audiencias?fecha=YYYY-MM-DD`**:
  * Retorna la agenda del día ordenada por `hora`. Realiza un `LEFT JOIN` con `carpetas`, `usuarios` (abogado) y `tipos_audiencia`. Filtra estrictamente por `estudio_id`.
* **`GET /api/audiencias/orphan`**:
  * Retorna las audiencias donde `carpeta_id` es `NULL`. Filtra estrictamente por `estudio_id`.
* **`PATCH /api/audiencias/:id/vincular`**:
  * Valida que la audiencia pertenezca al estudio y que no tenga ya una carpeta vinculada.
  * Valida que la carpeta de destino exista y pertenezca al mismo estudio.
  * Setea el `carpeta_id` en la audiencia y agrega un registro en la tabla `bitacora_carpetas` con la acción `"audiencia_vinculada"` en una transacción única.

## Testing Decisions

* **Pruebas en DB (`packages/db/tests/audiencias.test.ts`)**:
  * Validar creación de audiencias con y sin relación a carpeta.
  * Validar restricciones de clave foránea e índices compuestos.
* **Pruebas en API (`apps/api/tests/audiencias.test.ts`)**:
  * Inyectar peticiones HTTP simuladas usando `app.inject()`.
  * Validar denegación de acceso para peticiones no autenticadas (retorno de `401`).
  * Validar flujo completo: creación con/sin carpeta, listado de agenda por fecha, listado de huérfanas, y vinculación transaccional con bitácora.
  * Validar prevención de manipulación cruzada de inquilinos (cross-tenant).

## Out of Scope

* Permisos de acceso por sector a las audiencias (será implementado en el Ticket 5).
* Interfaz gráfica en el Frontend.
* Procesamiento automatizado de correos para agendar audiencias.

## Further Notes

Ninguna.
