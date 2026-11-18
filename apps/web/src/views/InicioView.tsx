import { useMemo, useState } from "react";
import {
  fetchActasHuerfanas,
  fetchAudienciasRango,
  fetchCarpetas,
  type Audiencia,
  type Carpeta,
} from "../lib/domain";
import { alias, fmtDate, fmtHora, toYmd } from "../lib/format";
import { AbogadoTag, ErrorBox, Loading, TipoBadge, useApp, useAsync } from "../components/ui";
import { CarpetaDetalle } from "./CarpetasView";

/** Días sin cambios a partir de los cuales una carpeta en trámite merece revisión. */
const DIAS_SIN_MOVIMIENTO = 30;

const sumarDias = (base: Date, dias: number) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias);

/**
 * Lo primero que necesita cada perfil al entrar:
 * - Titular: la foto del estudio (carga por abogado y carpetas quietas).
 * - Abogado: sus carpetas en trámite y su agenda de la semana.
 * - Asistente: las actas por vincular y la agenda de todo el estudio.
 */
export function InicioView({ irA }: { irA: (tab: "carpetas" | "calendario" | "actas") => void }) {
  const { perfil } = useApp();
  const [abierta, setAbierta] = useState<string | null>(null);
  const hoy = new Date();
  const desde = toYmd(hoy);
  const hasta = toYmd(sumarDias(hoy, 6));

  const carpetas = useAsync(fetchCarpetas, []);
  const semana = useAsync(() => fetchAudienciasRango(desde, hasta), [desde, hasta]);
  const actas = useAsync(() => (perfil === "asistente" ? fetchActasHuerfanas() : Promise.resolve([])), [perfil]);

  const error = carpetas.error ?? semana.error ?? actas.error;
  const cargando = !carpetas.data || !semana.data || !actas.data;

  return (
    <section aria-label="Inicio">
      {error ? <ErrorBox error={error} onRetry={() => { carpetas.reload(); semana.reload(); actas.reload(); }} /> : null}
      {cargando && !error && <Loading />}
      {!cargando && perfil === "titular" && (
        <InicioTitular carpetas={carpetas.data!} semana={semana.data!} onAbrir={setAbierta} irA={irA} />
      )}
      {!cargando && perfil === "abogado" && (
        <InicioAbogado carpetas={carpetas.data!} semana={semana.data!} onAbrir={setAbierta} irA={irA} />
      )}
      {!cargando && perfil === "asistente" && (
        <InicioAsistente actasPendientes={actas.data!.length} semana={semana.data!} irA={irA} />
      )}
      {abierta && (
        <CarpetaDetalle
          id={abierta}
          onClose={() => {
            setAbierta(null);
            carpetas.reload();
          }}
        />
      )}
    </section>
  );
}

type IrA = (tab: "carpetas" | "calendario" | "actas") => void;

function useEnTramite(carpetas: Carpeta[]) {
  const { catalogos } = useApp();
  const enTramiteId = catalogos.estadosCaso.find((e) => e.codigo === "en_tramite")?.id;
  return useMemo(() => carpetas.filter((c) => c.estadoCasoId === enTramiteId), [carpetas, enTramiteId]);
}

function InicioTitular({ carpetas, semana, onAbrir, irA }: { carpetas: Carpeta[]; semana: Audiencia[]; onAbrir: (id: string) => void; irA: IrA }) {
  const { equipo } = useApp();
  const enTramite = useEnTramite(carpetas);
  const limite = sumarDias(new Date(), -DIAS_SIN_MOVIMIENTO).toISOString();
  const quietas = enTramite.filter((c) => c.updatedAt < limite).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  const carga = equipo
    .filter((m) => m.rol === "abogado")
    .map((m) => ({
      abogado: m,
      enTramite: enTramite.filter((c) => c.abogadoResponsableId === m.id).length,
      total: carpetas.filter((c) => c.abogadoResponsableId === m.id).length,
      audiencias: semana.filter((a) => a.abogadoId === m.id).length,
    }))
    .sort((a, b) => b.enTramite - a.enTramite);

  return (
    <>
      <div className="metric-grid">
        <Metrica etiqueta="Carpetas en trámite" valor={enTramite.length} onClick={() => irA("carpetas")} />
        <Metrica etiqueta="Audiencias en los próximos 7 días" valor={semana.length} onClick={() => irA("calendario")} />
        <Metrica etiqueta={`Sin movimiento hace más de ${DIAS_SIN_MOVIMIENTO} días`} valor={quietas.length} />
      </div>

      <p className="subhead">Carga por abogado</p>
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Abogado</th>
            <th scope="col">En trámite</th>
            <th scope="col">Total</th>
            <th scope="col">Audiencias esta semana</th>
          </tr>
        </thead>
        <tbody>
          {carga.map((fila) => (
            <tr key={fila.abogado.id}>
              <td>
                <AbogadoTag email={fila.abogado.email} />
                {fila.abogado.esTitular && <span className="small muted"> titular</span>}
              </td>
              <td>{fila.enTramite}</td>
              <td>{fila.total}</td>
              <td>{fila.audiencias}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="subhead">Carpetas sin movimiento</p>
      {quietas.length === 0 ? (
        <p className="small muted">Todas las carpetas en trámite tuvieron cambios en los últimos {DIAS_SIN_MOVIMIENTO} días.</p>
      ) : (
        quietas.map((c) => (
          <CarpetaFila key={c.id} carpeta={c} detalle={`último cambio el ${fmtDate(c.updatedAt.slice(0, 10))}`} onAbrir={onAbrir} />
        ))
      )}
    </>
  );
}

function InicioAbogado({ carpetas, semana, onAbrir, irA }: { carpetas: Carpeta[]; semana: Audiencia[]; onAbrir: (id: string) => void; irA: IrA }) {
  const enTramite = useEnTramite(carpetas);
  return (
    <>
      <div className="metric-grid">
        <Metrica etiqueta="Mis carpetas en trámite" valor={enTramite.length} onClick={() => irA("carpetas")} />
        <Metrica etiqueta="Mis audiencias en los próximos 7 días" valor={semana.length} onClick={() => irA("calendario")} />
      </div>
      <p className="subhead">Mi agenda de la semana</p>
      <Agenda semana={semana} vacia="No tenés audiencias en los próximos 7 días." />
      <p className="subhead">Mis carpetas en trámite</p>
      {enTramite.length === 0 ? (
        <p className="small muted">No tenés carpetas en trámite a tu cargo.</p>
      ) : (
        enTramite.map((c) => <CarpetaFila key={c.id} carpeta={c} detalle={`Expte. ${c.expediente}`} onAbrir={onAbrir} />)
      )}
    </>
  );
}

function InicioAsistente({ actasPendientes, semana, irA }: { actasPendientes: number; semana: Audiencia[]; irA: IrA }) {
  return (
    <>
      <div className="metric-grid">
        <Metrica etiqueta="Actas por vincular" valor={actasPendientes} onClick={() => irA("actas")} destacada={actasPendientes > 0} />
        <Metrica etiqueta="Audiencias del estudio en los próximos 7 días" valor={semana.length} onClick={() => irA("calendario")} />
      </div>
      {actasPendientes > 0 && (
        <p className="hint">
          Hay {actasPendientes === 1 ? "1 acta" : `${actasPendientes} actas`} del SECLO esperando su carpeta.{" "}
          <button type="button" className="btn-sm primary" onClick={() => irA("actas")}>
            Ir a la bandeja de actas
          </button>
        </p>
      )}
      <p className="subhead">Agenda del estudio esta semana</p>
      <Agenda semana={semana} vacia="No hay audiencias en los próximos 7 días." />
    </>
  );
}

function Metrica({ etiqueta, valor, onClick, destacada }: { etiqueta: string; valor: number; onClick?: () => void; destacada?: boolean }) {
  const contenido = (
    <>
      <p className="label">{etiqueta}</p>
      <p className="val">{valor}</p>
    </>
  );
  return onClick ? (
    <button type="button" className={`metric metric-link${destacada ? " metric-alerta" : ""}`} onClick={onClick}>
      {contenido}
    </button>
  ) : (
    <div className="metric">{contenido}</div>
  );
}

function Agenda({ semana, vacia }: { semana: Audiencia[]; vacia: string }) {
  if (semana.length === 0) return <p className="small muted">{vacia}</p>;
  return (
    <>
      {semana.map((a) => (
        <div key={a.id} className="timeline-item">
          <div className="timeline-title">
            {fmtDate(a.fecha)} {fmtHora(a.hora)} <TipoBadge nombre={a.tipoNombre} color={a.tipoColor} />{" "}
            <AbogadoTag email={a.abogadoEmail} />
          </div>
          <div className="small muted">
            {a.caratula ?? "Sin carpeta asignada"}
            {a.expediente ? ` · Expte. ${a.expediente}` : ""}
          </div>
        </div>
      ))}
    </>
  );
}

function CarpetaFila({ carpeta: c, detalle, onAbrir }: { carpeta: Carpeta; detalle: string; onAbrir: (id: string) => void }) {
  const { equipo } = useApp();
  const responsable = equipo.find((m) => m.id === c.abogadoResponsableId);
  return (
    <article className="aud-card">
      <div className="card-row">
        <div className="card-main">
          <p className="card-title">📁 {c.caratula}</p>
          <p className="card-meta">
            {detalle}
            {responsable && <> · a cargo de {alias(responsable.email)}</>}
          </p>
        </div>
        <button type="button" className="btn-sm" onClick={() => onAbrir(c.id)}>
          📂 Abrir carpeta
        </button>
      </div>
    </article>
  );
}
