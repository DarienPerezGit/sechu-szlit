import { useMemo, useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import {
  actualizarCarpeta,
  crearCarpeta,
  fetchAudienciasDeCarpeta,
  fetchBitacora,
  fetchCarpeta,
  fetchCarpetas,
  type Carpeta,
} from "../lib/domain";
import { describirAccion, estadoCasoTone, fmtDate, fmtDateTime, fmtHora } from "../lib/format";
import { AudienciaForm } from "../components/AudienciaForm";
import {
  AbogadoTag,
  ErrorBox,
  Loading,
  Modal,
  TipoBadge,
  errorMessage,
  useApp,
  useAsync,
} from "../components/ui";

export function CarpetasView() {
  const { catalogos } = useApp();
  const { data: carpetas, error, loading, reload } = useAsync(fetchCarpetas, []);
  const [texto, setTexto] = useState("");
  const [estadoId, setEstadoId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);

  const estadoPorId = useMemo(() => new Map(catalogos.estadosCaso.map((e) => [e.id, e])), [catalogos]);
  const sectorPorId = useMemo(() => new Map(catalogos.sectores.map((s) => [s.id, s])), [catalogos]);

  const lista = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return (carpetas ?? [])
      .filter((c) => !estadoId || c.estadoCasoId === Number(estadoId))
      .filter((c) => !sectorId || c.sectorActualId === Number(sectorId))
      .filter(
        (c) =>
          !q ||
          [c.caratula, c.expediente, c.demandada].some((field) => field.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [carpetas, texto, estadoId, sectorId]);

  return (
    <section aria-label="Carpetas">
      <div className="row-flex section-head">
        <p className="hint">Legajos de casos. Cada carpeta avanza por los sectores del estudio.</p>
        <button type="button" className="primary" onClick={() => setCreando(true)}>
          ➕ Nueva carpeta
        </button>
      </div>

      <div className="list-controls">
        <input
          type="text"
          aria-label="Buscar carpeta"
          placeholder="Buscar por carátula, expediente o demandada…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <select aria-label="Filtrar por estado" value={estadoId} onChange={(e) => setEstadoId(e.target.value)}>
          <option value="">Todos los estados</option>
          {catalogos.estadosCaso.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por sector" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
          <option value="">Todos los sectores</option>
          {catalogos.sectores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {loading && !carpetas && <Loading />}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {carpetas && lista.length === 0 && (
        <div className="empty">
          {carpetas.length === 0 ? "Todavía no hay carpetas. Creá la primera." : "Ninguna carpeta coincide con el filtro."}
        </div>
      )}

      {lista.map((c) => {
        const estado = estadoPorId.get(c.estadoCasoId);
        const sector = sectorPorId.get(c.sectorActualId);
        return (
          <article key={c.id} className="aud-card">
            <div className="card-row">
              <div className="card-main">
                <p className="card-title">📁 {c.caratula}</p>
                <p className="card-meta">
                  Expte. {c.expediente} · Demandada: {c.demandada}
                </p>
                <p className="card-meta">
                  <span className={`pill pill-${estadoCasoTone(estado?.codigo)}`}>{estado?.nombre ?? "—"}</span>
                  <span className="sector-tag">{sector?.nombre ?? "—"}</span>
                </p>
              </div>
              <div className="btn-group">
                <button type="button" className="btn-sm" onClick={() => setAbierta(c.id)}>
                  📂 Abrir carpeta
                </button>
              </div>
            </div>
          </article>
        );
      })}

      {creando && (
        <NuevaCarpetaModal
          onClose={() => setCreando(false)}
          onCreated={(carpeta) => {
            setCreando(false);
            reload();
            setAbierta(carpeta.id);
          }}
        />
      )}
      {abierta && (
        <CarpetaDetalle
          id={abierta}
          onClose={() => {
            setAbierta(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function NuevaCarpetaModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Carpeta) => void }) {
  const { catalogos, toast } = useApp();
  const pipeline = catalogos.sectores;
  const [form, setForm] = useState({
    caratula: "",
    expediente: "",
    demandada: "",
    sectorActualId: pipeline[0]?.id ?? 0,
    estadoCasoId: catalogos.estadosCaso.find((e) => e.codigo === "en_tramite")?.id ?? catalogos.estadosCaso[0]?.id ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: typeof f[key] === "number" ? Number(e.target.value) : e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const carpeta = await crearCarpeta({
        ...form,
        caratula: form.caratula.trim(),
        expediente: form.expediente.trim(),
        demandada: form.demandada.trim(),
      });
      toast("Carpeta creada");
      onCreated(carpeta);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Nueva carpeta"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="form-carpeta" className="primary" disabled={saving}>
            {saving ? "Creando…" : "Crear carpeta"}
          </button>
        </>
      }
    >
      <form id="form-carpeta" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <div className="form-row">
          <label htmlFor="cp-caratula">Carátula</label>
          <input id="cp-caratula" type="text" required placeholder="Pérez, Juan c/ Acme S.A. s/ despido" value={form.caratula} onChange={set("caratula")} />
        </div>
        <div className="form-grid-2">
          <div className="form-row">
            <label htmlFor="cp-expediente">Expediente</label>
            <input id="cp-expediente" type="text" required placeholder="SECLO 123456/2026" value={form.expediente} onChange={set("expediente")} />
          </div>
          <div className="form-row">
            <label htmlFor="cp-demandada">Demandada</label>
            <input id="cp-demandada" type="text" required placeholder="Acme S.A." value={form.demandada} onChange={set("demandada")} />
          </div>
          <div className="form-row">
            <label htmlFor="cp-sector">Sector</label>
            <select id="cp-sector" value={form.sectorActualId} onChange={set("sectorActualId")}>
              {pipeline.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="cp-estado">Estado</label>
            <select id="cp-estado" value={form.estadoCasoId} onChange={set("estadoCasoId")}>
              {catalogos.estadosCaso.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function CarpetaDetalle({ id, onClose }: { id: string; onClose: () => void }) {
  const { catalogos, toast } = useApp();
  const carpeta = useAsync(() => fetchCarpeta(id), [id]);
  const audiencias = useAsync(() => fetchAudienciasDeCarpeta(id), [id]);
  const bitacora = useAsync(() => fetchBitacora(id), [id]);
  const [agendando, setAgendando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [conflicto, setConflicto] = useState<string | null>(null);

  const reloadAll = () => {
    carpeta.reload();
    audiencias.reload();
    bitacora.reload();
  };

  async function cambiar(campo: "estadoCasoId" | "sectorActualId", valor: number) {
    const c = carpeta.data;
    if (!c) return;
    setGuardando(true);
    setConflicto(null);
    try {
      await actualizarCarpeta(c.id, { version: c.version, [campo]: valor });
      toast(campo === "estadoCasoId" ? "Estado actualizado" : "Carpeta movida de sector");
    } catch (err) {
      setConflicto(
        err instanceof ApiError && err.status === 409
          ? "Otra persona modificó esta carpeta. Se recargaron los datos."
          : errorMessage(err),
      );
    } finally {
      setGuardando(false);
      reloadAll();
    }
  }

  const c = carpeta.data;
  return (
    <>
      <Modal title="📁 Carpeta del caso" onClose={onClose} footer={<button type="button" className="primary" onClick={onClose}>Cerrar</button>}>
        {carpeta.error ? <ErrorBox error={carpeta.error} onRetry={carpeta.reload} /> : null}
        {!c && !carpeta.error && <Loading />}
        {c && (
          <>
            <div className="success-box">
              <strong>{c.caratula}</strong>
              <br />
              <span className="small">
                Expte. {c.expediente} · Demandada: {c.demandada} · versión {c.version}
              </span>
            </div>
            {conflicto && <div className="warn-box">{conflicto}</div>}
            <div className="form-grid-2">
              <div className="form-row">
                <label htmlFor="det-estado">Estado del caso</label>
                <select id="det-estado" disabled={guardando} value={c.estadoCasoId} onChange={(e) => cambiar("estadoCasoId", Number(e.target.value))}>
                  {catalogos.estadosCaso.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="det-sector">Sector actual</label>
                <select id="det-sector" disabled={guardando} value={c.sectorActualId} onChange={(e) => cambiar("sectorActualId", Number(e.target.value))}>
                  {catalogos.sectores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <p className="subhead">📅 Audiencias del caso</p>
        {audiencias.error ? <ErrorBox error={audiencias.error} onRetry={audiencias.reload} /> : null}
        {audiencias.data?.length === 0 && <p className="small muted">Sin audiencias agendadas.</p>}
        {audiencias.data?.map((a, i) => (
          <div key={a.id} className="timeline-item">
            <div className="timeline-title">
              S{i + 1} · {fmtDate(a.fecha)} {fmtHora(a.hora)} <TipoBadge nombre={a.tipoNombre} color={a.tipoColor} />{" "}
              <AbogadoTag email={a.abogadoEmail} /> <span className={`estado-badge estado-${a.estado}`}>{a.estado}</span>
            </div>
            {a.notasInternas && <div className="small muted">{a.notasInternas}</div>}
          </div>
        ))}
        {c && (
          <button type="button" className="btn-sm primary" onClick={() => setAgendando(true)}>
            ➕ Agendar próxima audiencia
          </button>
        )}

        <p className="subhead">📝 Bitácora</p>
        {bitacora.error ? <ErrorBox error={bitacora.error} onRetry={bitacora.reload} /> : null}
        <div className="bitacora">
          {bitacora.data?.map((b) => (
            <div key={b.id} className="bitacora-item">
              <strong>{b.usuarioEmail ?? "sistema"}</strong> · <span className="muted">{fmtDateTime(b.fecha)}</span>
              <br />
              {describirAccion(b.accionRealizada, b.metadata)}
            </div>
          ))}
        </div>
      </Modal>
      {agendando && c && (
        <AudienciaForm
          carpeta={c}
          onClose={() => setAgendando(false)}
          onSaved={() => {
            setAgendando(false);
            reloadAll();
          }}
        />
      )}
    </>
  );
}
