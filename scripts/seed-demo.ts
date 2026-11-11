/**
 * Datos de demo realistas para presentar SECHUB.
 *
 * Carga todo a través de la API (no directo a la base), así la bitácora, los
 * permisos y los efectos de vincular actas son los mismos que en uso real.
 * Es idempotente: si una carpeta con el mismo expediente ya existe, la saltea
 * junto con sus audiencias y actas.
 *
 * Uso:
 *   pnpm seed:demo                              # contra http://localhost:3000
 *   TARGET_URL=https://<deploy> pnpm seed:demo  # contra un deploy
 *
 * Las fechas son relativas a HOY, para que la demo siempre tenga audiencias
 * próximas en el calendario.
 */
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: "apps/web/.env.local" });

const baseUrl = (process.env.TARGET_URL ?? "http://localhost:3000").replace(/\/$/, "");
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const email = process.env.DEMO_EMAIL ?? "admin@sechub.test";
const password = process.env.DEMO_PASSWORD ?? "DevOnly-Admin-2024!";

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (o sus VITE_*).");
  process.exit(1);
}

/* ---------- Fechas relativas a hoy ---------- */

function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  // Las audiencias no caen en fin de semana.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- Escenario ---------- */

type SectorCodigo = "comunicaciones" | "seclo" | "redaccion" | "procesal" | "accidentes" | "mediaciones_civiles";
type TipoAudCodigo = "seclo" | "judicial" | "accidente" | "comunicacion" | "mediacion" | "consulta";
type TipoActaCodigo = "audiencia_conciliatoria" | "pase_segunda_fecha" | "acuerdo" | "desistimiento";

interface AudienciaDemo {
  fecha: string;
  hora: string;
  tipo: TipoAudCodigo;
  abogado: "admin" | "viewer";
  notas?: string;
  link?: string;
}
interface CarpetaDemo {
  caratula: string;
  expediente: string;
  demandada: string;
  sector: SectorCodigo;
  audiencias: AudienciaDemo[];
  /** Acta que se vincula al cargar (para mostrar historial ya cerrado). */
  cerrarCon?: { tipo: TipoActaCodigo; conciliador: string };
}

const CARPETAS: CarpetaDemo[] = [
  {
    caratula: "Fernández, Carla c/ Textil Norte S.R.L. s/ diferencias salariales",
    expediente: "SECLO 207733/2026",
    demandada: "Textil Norte S.R.L.",
    sector: "seclo",
    audiencias: [
      { fecha: dia(3), hora: "10:30", tipo: "seclo", abogado: "admin", notas: "Segunda audiencia. La empresa trae propuesta de pago en cuotas.", link: "https://meet.google.com/abc-defg-hij" },
    ],
  },
  {
    caratula: "Rodríguez, Martín c/ Supermercados del Plata S.A. s/ despido",
    expediente: "SECLO 205120/2026",
    demandada: "Supermercados del Plata S.A.",
    sector: "seclo",
    audiencias: [
      { fecha: dia(2), hora: "09:00", tipo: "seclo", abogado: "admin", notas: "Primera audiencia. Reclamo art. 245 LCT + multas ley 25.323." },
    ],
  },
  {
    caratula: "López, Diego c/ Transportes Ruta 3 S.A. s/ accidente in itinere",
    expediente: "CM 44871/2026",
    demandada: "Transportes Ruta 3 S.A.",
    sector: "accidentes",
    audiencias: [
      { fecha: dia(5), hora: "11:00", tipo: "accidente", abogado: "viewer", notas: "Comisión Médica 10. Llevar estudios de traumatología." },
    ],
  },
  {
    caratula: "Acosta, Pablo c/ Metalúrgica Avellaneda S.A. s/ despido",
    expediente: "CNT 31877/2026",
    demandada: "Metalúrgica Avellaneda S.A.",
    sector: "procesal",
    audiencias: [
      { fecha: dia(8), hora: "12:00", tipo: "judicial", abogado: "admin", notas: "Juzgado Nacional del Trabajo N° 45. Audiencia art. 80 LO." },
    ],
  },
  {
    caratula: "Sosa, Mariela c/ Clínica San Jorge S.A. s/ despido",
    expediente: "COM 0921/2026",
    demandada: "Clínica San Jorge S.A.",
    sector: "comunicaciones",
    audiencias: [
      { fecha: dia(1), hora: "16:00", tipo: "comunicacion", abogado: "viewer", notas: "Entrevista inicial. Traer recibos y telegramas." },
    ],
  },
  {
    caratula: "Benítez, Rocío c/ Call Center Sur S.A. s/ despido discriminatorio",
    expediente: "SECLO 199402/2026",
    demandada: "Call Center Sur S.A.",
    sector: "redaccion",
    audiencias: [],
  },
  {
    caratula: "Medina, Julio c/ Consorcio Av. Rivadavia 4500 s/ daños",
    expediente: "MED 7731/2026",
    demandada: "Consorcio Av. Rivadavia 4500",
    sector: "mediaciones_civiles",
    audiencias: [
      { fecha: dia(6), hora: "15:00", tipo: "mediacion", abogado: "viewer", notas: "Mediación prejudicial obligatoria." },
    ],
  },
  {
    caratula: "Herrera, Lucas c/ Distribuidora Oeste S.A. s/ despido",
    expediente: "SECLO 201566/2026",
    demandada: "Distribuidora Oeste S.A.",
    sector: "seclo",
    audiencias: [{ fecha: dia(-9), hora: "10:00", tipo: "seclo", abogado: "admin", notas: "El trabajador desiste del reclamo." }],
    cerrarCon: { tipo: "desistimiento", conciliador: "Dr. Raúl Pereyra" },
  },
  {
    caratula: "Castro, Valeria c/ Logística Pampeana S.R.L. s/ despido",
    expediente: "SECLO 198870/2026",
    demandada: "Logística Pampeana S.R.L.",
    sector: "seclo",
    audiencias: [{ fecha: dia(-6), hora: "11:30", tipo: "seclo", abogado: "admin", notas: "Acuerdo por indemnización completa en 3 cuotas." }],
    cerrarCon: { tipo: "acuerdo", conciliador: "Dra. Silvia Romero" },
  },
];

/** Actas que quedan en la bandeja para vincular en vivo durante la demo. */
const ACTAS_EN_BANDEJA = [
  // Coincide por expediente con Fernández → la app la sugiere sola.
  { expediente: "SECLO 207733/2026", tipo: "acuerdo" as TipoActaCodigo, conciliador: "Dra. Marta Ferreyra", conciliadorEmail: "mferreyra@trabajo.gob.ar" },
  // Pase a 2da fecha de Rodríguez → la carpeta sigue en trámite.
  { expediente: "SECLO 205120/2026", tipo: "pase_segunda_fecha" as TipoActaCodigo, conciliador: "Dr. Andrés Quiroga", conciliadorEmail: null },
];

/** Bloqueo de agenda sin carpeta (bandeja de audiencias huérfanas). */
const AUDIENCIA_SIN_CARPETA: AudienciaDemo = {
  fecha: dia(4),
  hora: "17:00",
  tipo: "consulta",
  abogado: "admin",
  notas: "Consulta de cliente nuevo derivado por el sindicato. Todavía sin carátula.",
};

/* ---------- Cliente ---------- */

let token = "";

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

interface Item { id: number; codigo: string }

async function main() {
  console.log(`→ Destino: ${baseUrl}`);

  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok) throw new Error(`Login Supabase falló: ${auth.status} ${await auth.text()}`);
  token = ((await auth.json()) as { access_token: string }).access_token;

  const cat = await api<{ sectores: Item[]; estadosCaso: Item[]; tiposAudiencia: Item[]; tiposActa: Item[]; estadosActa: Item[] }>("/catalogos");
  const byCode = (list: Item[], codigo: string) => {
    const item = list.find((i) => i.codigo === codigo);
    if (!item) throw new Error(`Código de catálogo inexistente: ${codigo}`);
    return item.id;
  };
  const equipo = await api<{ id: string; email: string }[]>("/equipo");
  const abogado = (who: "admin" | "viewer") =>
    (equipo.find((m) => m.email.startsWith(who)) ?? equipo[0]).id;

  const existentes = new Set((await api<{ expediente: string }[]>("/carpetas")).map((c) => c.expediente));
  let creadas = 0;

  const crearAudiencia = (a: AudienciaDemo, carpetaId: string | null) =>
    api<{ id: string }>("/audiencias", {
      method: "POST",
      body: {
        carpetaId,
        abogadoId: abogado(a.abogado),
        fecha: a.fecha,
        hora: a.hora,
        tipoAudienciaId: byCode(cat.tiposAudiencia, a.tipo),
        linkReunion: a.link ?? null,
        notasInternas: a.notas ?? null,
      },
    });

  for (const c of CARPETAS) {
    if (existentes.has(c.expediente)) {
      console.log(`  · ya existe: ${c.expediente}`);
      continue;
    }
    const carpeta = await api<{ id: string }>("/carpetas", {
      method: "POST",
      body: {
        caratula: c.caratula,
        expediente: c.expediente,
        demandada: c.demandada,
        sectorActualId: byCode(cat.sectores, c.sector),
        estadoCasoId: byCode(cat.estadosCaso, "en_tramite"),
      },
    });
    const audienciaIds: string[] = [];
    for (const a of c.audiencias) audienciaIds.push((await crearAudiencia(a, carpeta.id)).id);

    if (c.cerrarCon && audienciaIds[0]) {
      const acta = await api<{ id: string }>("/actas", {
        method: "POST",
        body: {
          expediente: c.expediente,
          tipoActaId: byCode(cat.tiposActa, c.cerrarCon.tipo),
          estadoActaId: byCode(cat.estadosActa, "firmada"),
          conciliadorNombre: c.cerrarCon.conciliador,
          fecha: c.audiencias[0].fecha,
        },
      });
      await api(`/actas/${acta.id}/vincular`, {
        method: "PATCH",
        body: { carpetaId: carpeta.id, audienciaId: audienciaIds[0] },
      });
    }
    creadas++;
    console.log(`  ✓ ${c.caratula}`);
  }

  if (creadas === 0) {
    console.log("→ No se crearon carpetas nuevas: se omiten actas y audiencias sueltas para no duplicarlas.");
    return;
  }

  for (const a of ACTAS_EN_BANDEJA) {
    await api("/actas", {
      method: "POST",
      body: {
        expediente: a.expediente,
        tipoActaId: byCode(cat.tiposActa, a.tipo),
        estadoActaId: byCode(cat.estadosActa, "pendiente"),
        conciliadorNombre: a.conciliador,
        conciliadorEmail: a.conciliadorEmail,
        fecha: dia(0),
      },
    });
    console.log(`  ✓ acta en bandeja: ${a.expediente} (${a.tipo})`);
  }

  await crearAudiencia(AUDIENCIA_SIN_CARPETA, null);
  console.log(`  ✓ audiencia sin carpeta: ${AUDIENCIA_SIN_CARPETA.fecha} ${AUDIENCIA_SIN_CARPETA.hora}`);
  console.log(`→ Listo: ${creadas} carpetas nuevas.`);
}

main().catch((error) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
