import { useMemo, useState } from "react";
import { fetchAudienciasRango, fetchCarpetas, vincularAudiencia, type Audiencia } from "../lib/domain";
import { capitalize, fmtDateLong, fmtHora, toYmd } from "../lib/format";
import { AudienciaForm } from "../components/AudienciaForm";
import { AbogadoTag, ErrorBox, Modal, TipoBadge, errorMessage, useApp, useAsync } from "../components/ui";
import { CarpetaDetalle } from "./CarpetasView";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Primer lunes de la grilla de 6 semanas que contiene el mes. */
function gridStart(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
}

export function CalendarioView() {
  const { catalogos } = useApp();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [nuevaEn, setNuevaEn] = useState<string | null>(null);
  const [carpetaAbierta, setCarpetaAbierta] = useState<string | null>(null);

  const dias = useMemo(() => {
    const start = gridStart(month);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const desde = toYmd(dias[0]);
  const hasta = toYmd(dias[41]);

  const audiencias = useAsync(() => fetchAudienciasRango(desde, hasta), [desde, hasta]);
  const carpetas = useAsync(fetchCarpetas, []);

  const porDia = useMemo(() => {
    const map = new Map<string, Audiencia[]>();
    for (const a of audiencias.data ?? []) {
      const list = map.get(a.fecha) ?? [];
      list.push(a);
      map.set(a.fecha, list);
    }
    return map;
  }, [audiencias.data]);

  const hoy = toYmd(new Date());
  const label = capitalize(month.toLocaleDateString("es-AR", { month: "long", year: "numeric" }));
  const mover = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <section aria-label="Calendario">
      <div className="cal-controls">
        <div className="cal-nav">
          <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior">
            ‹
          </button>
          <span className="cal-label">{label}</span>
          <button type="button" onClick={() => mover(1)} aria-label="Mes siguiente">
            ›
          </button>
        </div>
        <div className="row-flex">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Hoy
          </button>
          <button type="button" className="primary" onClick={() => setNuevaEn(hoy)}>
            ➕ Nueva audiencia
          </button>
        </div>
      </div>

      <div className="leyenda">
        Tipos:{" "}
        {catalogos.tiposAudiencia.map((t) => (
          <span key={t.id} className="leyenda-item">
            <span className="color-dot" style={{ background: t.color ?? "#6b6b66" }} />
            {t.nombre}
          </span>
        ))}
      </div>

      {audiencias.error ? <ErrorBox error={audiencias.error} onRetry={audiencias.reload} /> : null}

      <div className="calendar-grid" aria-busy={audiencias.loading}>
        {DIAS.map((d) => (
          <div key={d} className="cal-header-day">
            {d}
          </div>
        ))}
        {dias.map((d) => {
          const ymd = toYmd(d);
          const list = porDia.get(ymd) ?? [];
          const otherMonth = d.getMonth() !== month.getMonth();
          return (
            <button
              type="button"
              key={ymd}
              className={`cal-day${otherMonth ? " other-month" : ""}${ymd === hoy ? " today" : ""}`}
              onClick={() => setDiaAbierto(ymd)}
              aria-label={`${fmtDateLong(ymd)}: ${list.length} audiencias`}
            >
              <div className="day-num">{d.getDate()}</div>
              {list.slice(0, 3).map((a) => (
                <div key={a.id} className="aud-chip" style={{ background: a.tipoColor ?? "#6b6b66" }}>
                  {fmtHora(a.hora)} {a.caratula ? a.caratula.split(/ c\//i)[0].slice(0, 20) : "Sin carpeta"}
                </div>
              ))}
              {list.length > 3 && <div className="small muted">+{list.length - 3} más</div>}
            </button>
          );
        })}
      </div>

      {diaAbierto && (
        <Modal
          title={fmtDateLong(diaAbierto)}
          onClose={() => setDiaAbierto(null)}
          footer={
            <button type="button" className="primary" onClick={() => setNuevaEn(diaAbierto)}>
              ➕ Agregar audiencia
            </button>
          }
        >
          {(porDia.get(diaAbierto) ?? []).length === 0 && <div className="empty">No hay audiencias este día</div>}
          {(porDia.get(diaAbierto) ?? []).map((a) => (
            <AudienciaCard
              key={a.id}
              audiencia={a}
              carpetas={carpetas.data ?? []}
              onAbrirCarpeta={setCarpetaAbierta}
              onChanged={audiencias.reload}
            />
          ))}
        </Modal>
      )}

      {nuevaEn && (
        <AudienciaForm
          fechaInicial={nuevaEn}
          carpetas={carpetas.data ?? []}
          onClose={() => setNuevaEn(null)}
          onSaved={() => {
            setNuevaEn(null);
            audiencias.reload();
          }}
        />
      )}

      {carpetaAbierta && (
        <CarpetaDetalle
          id={carpetaAbierta}
          onClose={() => {
            setCarpetaAbierta(null);
            audiencias.reload();
          }}
        />
      )}
    </section>
  );
}

function AudienciaCard({
  audiencia: a,
  carpetas,
  onAbrirCarpeta,
  onChanged,
}: {
  audiencia: Audiencia;
  carpetas: { id: string; caratula: string; expediente: string }[];
  onAbrirCarpeta: (id: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useApp();
  const [carpetaId, setCarpetaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function vincular() {
    setSaving(true);
    setError(null);
    try {
      await vincularAudiencia(a.id, carpetaId);
      toast("Audiencia vinculada a la carpeta");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="aud-card">
      <div className="card-row">
        <div className="card-main">
          <p className="card-title">{a.caratula ?? "Sin carpeta asignada"}</p>
          <p className="card-meta">
            <TipoBadge nombre={a.tipoNombre} color={a.tipoColor} /> <AbogadoTag email={a.abogadoEmail} />
            {a.expediente && <> · Expte. {a.expediente}</>} · {fmtHora(a.hora)}
          </p>
          {a.linkReunion && (
            <p className="card-meta">
              🔗{" "}
              <a href={a.linkReunion} target="_blank" rel="noopener noreferrer">
                {a.linkReunion.slice(0, 60)}
              </a>
            </p>
          )}
          {a.notasInternas && <p className="card-meta">{a.notasInternas}</p>}
        </div>
        <span className={`estado-badge estado-${a.estado}`}>{a.estado}</span>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="btn-group" style={{ marginTop: 8 }}>
        {a.carpetaId ? (
          <button type="button" className="btn-sm" onClick={() => onAbrirCarpeta(a.carpetaId!)}>
            📂 Abrir carpeta
          </button>
        ) : (
          <>
            <select aria-label="Carpeta a vincular" value={carpetaId} onChange={(e) => setCarpetaId(e.target.value)} style={{ width: "auto", flex: 1 }}>
              <option value="">Vincular a carpeta…</option>
              {carpetas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caratula} · {c.expediente}
                </option>
              ))}
            </select>
            <button type="button" className="btn-sm primary" disabled={!carpetaId || saving} onClick={vincular}>
              Vincular
            </button>
          </>
        )}
      </div>
    </div>
  );
}
