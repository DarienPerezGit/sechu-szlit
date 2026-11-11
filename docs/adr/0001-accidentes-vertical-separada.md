# ADR-0001: Accidentes como vertical separada, no etapa del pipeline SECLO

## Estado

Aceptado (con un punto pendiente de confirmación, ver "Pendiente" abajo).

## Contexto

Al diseñar el esquema de `sectores` para el pipeline de casos, se evaluó si
**Accidentes** debía compartir las etapas del pipeline laboral principal
(Comunicaciones → SECLO → Procesal) o si debía modelarse como una vertical
independiente, con circuito propio, igual que Mediaciones civiles y
Empleadores.

## Decisión

Accidentes se modela como vertical separada: `es_vertical = true`, sin
posición en `orden_pipeline`. No comparte las etapas Comunicaciones/SECLO/
Procesal del pipeline laboral principal.

## Evidencia

El prototipo original (`docs/design/prototipo-szlit.html`, seed del calendario del
20/05/2026) registra una audiencia con `tipo:'accidente'` para
**MORRESI, CARLOS ATILIO** cuyo `linkReunion` apunta a
`https://go.srt.gob.ar/85FDF398A6` — no a Zoom ni a un dominio de SECLO,
a diferencia de todas las demás audiencias de tipo `seclo`/`judicial` del
mismo seed.

En Argentina:

- Los reclamos por despido o diferencias salariales se tramitan ante el
  **SECLO** (conciliación obligatoria contra el empleador).
- Los reclamos por accidentes de trabajo se tramitan ante las
  **Comisiones Médicas de la SRT** (Superintendencia de Riesgos del
  Trabajo), reclamando contra la **ART**.

Son organismos, jurisdicciones y tiempos procesales distintos. Forzar el
reclamo ante la SRT/ART por el mismo embudo de
"Comunicaciones → SECLO → Procesal" habría sido un error de modelado de
dominio.

## Consecuencias

- `sectores` conserva Accidentes como fila con `es_vertical = true` y
  `orden_pipeline = NULL`, igual que Mediaciones civiles y Empleadores.
- El circuito interno propio de Accidentes (si necesita sub-etapas) se
  diseña por separado, sin acoplarse al pipeline laboral principal.
- Gracias al modelo catálogo + FK (ver decisión de esquema de `sectores`/
  `estados_caso`), revertir o ajustar esta decisión más adelante es barato:
  agregar filas al catálogo o cambiar `es_vertical` de una fila, no una
  migración de esquema.

## Pendiente

Confirmar con el cliente (Agus) si un mismo cliente del estudio con un caso
laboral en SECLO y un caso de Accidentes en simultáneo se maneja como:

- (a) dos Carpetas separadas, vinculadas por el cliente, o
- (b) una Carpeta con dos "ramas".

Pregunta concreta para la próxima conversación: *"Un reclamo de accidente
laboral, ¿pasa por las mismas etapas que un caso común (comunicaciones,
SECLO, etc.) o tiene su propio circuito distinto?"*

No es bloqueante para el desarrollo actual del schema, pero conviene
resolverlo antes de cargar datos reales de Accidentes en el sistema.
