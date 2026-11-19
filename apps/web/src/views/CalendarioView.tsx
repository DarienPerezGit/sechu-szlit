import { useMemo, useState } from "react";
import {
  actualizarAudiencia,
  fetchAudienciasRango,
  fetchCarpetas,
  vincularAudiencia,
  type Audiencia,
  type CambiosAudiencia,
} from "../lib/domain";
import { alias, capitalize, fmtDateLong, fmtHora, toYmd } from "../lib/format";
import { AudienciaForm } from "../components/AudienciaForm";
import {
  AbogadoTag,
  ErrorBox,
  Modal,
  TipoBadge,
  errorMessage,
  puedeEditarAudiencia,
  puedeReasignarAudiencia,
  puedeVerCarpeta,
  useApp,
  useAsync,
} from "../components/ui";
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
  const app = useApp();
  const { toast, equipo } = app;
  const [carpetaId, setCarpetaId] = useState("");
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pendiente = a.estado === "pendiente";
  const editable = pendiente && puedeEditarAudiencia(app, a);
  const reasignable = puedeReasignarAudiencia(app);
  const abreCarpeta = a.carpetaId !== null && puedeVerCarpeta(app, { abogadoResponsableId: a.carpetaAbogadoResponsableId });
  const responsable = equipo.find((m) => m.id === a.carpetaAbogadoResponsableId);

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
      {editando ? (
        <EditarAudiencia
          audiencia={a}
          reasignable={reasignable}
          onCancel={() => setEditando(false)}
          onSaved={() => {
            setEditando(false);
            onChanged();
          }}
        />
      ) : (
        <div className="btn-group" style={{ marginTop: 8 }}>
          {a.carpetaId &&
            (abreCarpeta ? (
              <button type="button" className="btn-sm" onClick={() => onAbrirCarpeta(a.carpetaId!)}>
                📂 Abrir carpeta
              </button>
            ) : (
              <span className="small muted">
                Cubrís esta audiencia: la carpeta la lleva {responsable ? alias(responsable.email) : "otro abogado"} y
                solo la abre su responsable.
              </span>
            ))}
          {!a.carpetaId && (
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
          {editable && (
            <button type="button" className="btn-sm" onClick={() => setEditando(true)}>
              {reasignable ? "✏️ Reprogramar o reasignar" : "✏️ Reprogramar"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Reprogramar (fecha, hora, notas) y, para el titular y procuración, reasignar a otro abogado. */
function EditarAudiencia({
  audiencia: a,
  reasignable,
  onCancel,
  onSaved,
}: {
  audiencia: Audiencia;
  reasignable: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { equipo, toast } = useApp();
  const abogados = equipo.filter((m) => m.rol === "abogado");
  const [fecha, setFecha] = useState(a.fecha);
  const [hora, setHora] = useState(a.hora.slice(0, 5));
  const [abogadoId, setAbogadoId] = useState(a.abogadoId);
  const [notas, setNotas] = useState(a.notasInternas ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const cambios: CambiosAudiencia = {};
    if (fecha !== a.fecha) cambios.fecha = fecha;
    if (hora !== a.hora.slice(0, 5)) cambios.hora = hora;
    if (reasignable && abogadoId !== a.abogadoId) cambios.abogadoId = abogadoId;
    if (notas !== (a.notasInternas ?? "")) cambios.notasInternas = notas || null;
    if (Object.keys(cambios).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await actualizarAudiencia(a.id, cambios);
      toast(cambios.abogadoId ? "Audiencia reasignada" : "Audiencia actualizada");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid-2">
        <div className="form-row">
          <label htmlFor={`ed-fecha-${a.id}`}>Fecha</label>
          <input id={`ed-fecha-${a.id}`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={`ed-hora-${a.id}`}>Hora</label>
          <input id={`ed-hora-${a.id}`} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        {reasignable && (
          <div className="form-row">
            <label htmlFor={`ed-abogado-${a.id}`}>Asiste</label>
            <select id={`ed-abogado-${a.id}`} value={abogadoId} onChange={(e) => setAbogadoId(e.target.value)}>
              {abogados.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label htmlFor={`ed-notas-${a.id}`}>Notas internas</label>
          <input id={`ed-notas-${a.id}`} type="text" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
      </div>
      <div className="btn-group">
        <button type="button" className="btn-sm" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn-sm primary" disabled={saving || !fecha || !hora} onClick={guardar}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
