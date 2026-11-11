import { apiFetch } from "./api";

/* ---------- Catálogos ---------- */

export interface CatalogoItem {
  id: number;
  codigo: string;
  nombre: string;
}
export interface Sector extends CatalogoItem {
  esVertical: boolean;
  ordenPipeline: number | null;
}
export interface TipoAudiencia extends CatalogoItem {
  color: string | null;
}
export interface Catalogos {
  estadosCaso: CatalogoItem[];
  tiposAudiencia: TipoAudiencia[];
  sectores: Sector[];
  tiposActa: CatalogoItem[];
  estadosActa: CatalogoItem[];
}
export interface MiembroEquipo {
  id: string;
  email: string;
}

/* ---------- Dominio ---------- */

export interface Carpeta {
  id: string;
  sectorActualId: number;
  estadoCasoId: number;
  version: number;
  expediente: string;
  caratula: string;
  demandada: string;
  empleadorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Audiencia {
  id: string;
  carpetaId: string | null;
  abogadoId: string;
  fecha: string;
  hora: string;
  estado: string;
  tipoAudienciaId: number;
  linkReunion: string | null;
  notasInternas: string | null;
  abogadoEmail: string | null;
  tipoNombre: string | null;
  tipoColor: string | null;
  /** Solo en agenda/calendario (join con la carpeta). */
  caratula?: string | null;
  expediente?: string | null;
}

export interface BitacoraEntry {
  id: string;
  accionRealizada: string;
  fecha: string;
  metadata: Record<string, unknown> | null;
  usuarioEmail: string | null;
}

export interface Acta {
  id: string;
  carpetaId: string | null;
  expediente: string | null;
  tipoActaId: number;
  estadoActaId: number;
  conciliadorNombre: string | null;
  conciliadorEmail: string | null;
  fecha: string | null;
  createdAt: string;
}

/* ---------- Helpers ---------- */

/** Las respuestas de lista siempre se normalizan a array (defensivo ante payloads inesperados). */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ---------- API ---------- */

export async function fetchCatalogos(): Promise<Catalogos> {
  const raw = (await apiFetch<Partial<Catalogos>>("/api/catalogos")) ?? {};
  return {
    estadosCaso: asArray(raw.estadosCaso),
    tiposAudiencia: asArray(raw.tiposAudiencia),
    sectores: asArray(raw.sectores),
    tiposActa: asArray(raw.tiposActa),
    estadosActa: asArray(raw.estadosActa),
  };
}

export const fetchEquipo = async () => asArray<MiembroEquipo>(await apiFetch("/api/equipo"));
export const fetchCarpetas = async () => asArray<Carpeta>(await apiFetch("/api/carpetas"));
export const fetchCarpeta = (id: string) => apiFetch<Carpeta>(`/api/carpetas/${id}`);
export const fetchAudienciasDeCarpeta = async (id: string) =>
  asArray<Audiencia>(await apiFetch(`/api/carpetas/${id}/audiencias`));
export const fetchBitacora = async (id: string) =>
  asArray<BitacoraEntry>(await apiFetch(`/api/carpetas/${id}/bitacora`));
export const fetchAudienciasRango = async (desde: string, hasta: string) =>
  asArray<Audiencia>(await apiFetch(`/api/audiencias?desde=${desde}&hasta=${hasta}`));
export const fetchActasHuerfanas = async () => asArray<Acta>(await apiFetch("/api/actas/orphan"));

export interface NuevaCarpeta {
  sectorActualId: number;
  estadoCasoId: number;
  expediente: string;
  caratula: string;
  demandada: string;
}
export const crearCarpeta = (body: NuevaCarpeta) =>
  apiFetch<Carpeta>("/api/carpetas", { method: "POST", ...json(body) });

export const actualizarCarpeta = (
  id: string,
  body: { version: number } & Partial<NuevaCarpeta>,
) => apiFetch<Carpeta>(`/api/carpetas/${id}`, { method: "PATCH", ...json(body) });

export interface NuevaAudiencia {
  carpetaId: string | null;
  abogadoId: string;
  fecha: string;
  hora: string;
  tipoAudienciaId: number;
  linkReunion: string | null;
  notasInternas: string | null;
}
export const crearAudiencia = (body: NuevaAudiencia) =>
  apiFetch<Audiencia>("/api/audiencias", { method: "POST", ...json(body) });

export const vincularAudiencia = (id: string, carpetaId: string) =>
  apiFetch(`/api/audiencias/${id}/vincular`, { method: "PATCH", ...json({ carpetaId }) });

export interface NuevaActa {
  expediente: string | null;
  tipoActaId: number;
  estadoActaId: number;
  conciliadorNombre: string | null;
  conciliadorEmail: string | null;
  fecha: string | null;
}
export const crearActa = (body: NuevaActa) =>
  apiFetch<Acta>("/api/actas", { method: "POST", ...json(body) });

export const vincularActa = (id: string, carpetaId: string, audienciaId: string) =>
  apiFetch(`/api/actas/${id}/vincular`, { method: "PATCH", ...json({ carpetaId, audienciaId }) });
