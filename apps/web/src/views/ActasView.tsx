import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  crearActa,
  fetchActasHuerfanas,
  fetchAudienciasDeCarpeta,
  fetchCarpetas,
  vincularActa,
  type Acta,
  type Audiencia,
  type Carpeta,
} from "../lib/domain";
import { fmtDate, fmtHora } from "../lib/format";
import { ErrorBox, Loading, Modal, errorMessage, useApp, useAsync } from "../components/ui";
import { CarpetaDetalle } from "./CarpetasView";

/** Efecto sobre la carpeta según el tipo de acta (espejo de acta-linking en la API). */
const EFECTO_POR_TIPO: Record<string, string> = {
  acuerdo: "La carpeta pasará a Conciliado",
  desistimiento: "La carpeta pasará a Desestimado",
};

export function ActasView() {
  const { catalogos } = useApp();
  const actas = useAsync(fetchActasHuerfanas, []);
  const carpetas = useAsync(fetchCarpetas, []);
  const [cargando, setCargando] = useState(false);
  const [vinculando, setVinculando] = useState<Acta | null>(null);
  const [carpetaAbierta, setCarpetaAbierta] = useState<string | null>(null);

  const tipoPorId = useMemo(() => new Map(catalogos.tiposActa.map((t) => [t.id, t])), [catalogos]);
  const estadoPorId = useMemo(() => new Map(catalogos.estadosActa.map((e) => [e.id, e])), [catalogos]);

  return (
    <section aria-label="Actas">
      <div className="row-flex section-head">
        <p className="hint">
          Bandeja de actas SECLO sin carpeta. Al vincular un acta, el caso se actualiza solo: estado, audiencia y bitácora.
        </p>
        <button type="button" className="primary" onClick={() => setCargando(true)}>
          ➕ Cargar acta
        </button>
      </div>

      {actas.data && (
        <div className="metric-grid">
          <div className="metric">
            <p className="label">Actas por vincular</p>
            <p className="val">{actas.data.length}</p>
          </div>
        </div>
      )}

      {actas.loading && !actas.data && <Loading />}
      {actas.error ? <ErrorBox error={actas.error} onRetry={actas.reload} /> : null}
      {actas.data?.length === 0 && <div className="empty">🎉 No hay actas pendientes de vincular.</div>}

      {actas.data?.map((acta) => {
        const tipo = tipoPorId.get(acta.tipoActaId);
        return (
          <article key={acta.id} className="aud-card">
            <div className="card-row">
              <div className="card-main">
                <p className="card-title">📋 {tipo?.nombre ?? "Acta"} · Expte. {acta.expediente ?? "sin número"}</p>
                <p className="card-meta">
                  {fmtDate(acta.fecha)}
                  {acta.conciliadorNombre && <> · 👤 {acta.conciliadorNombre}</>}
                  {acta.conciliadorEmail && <span className="muted"> ({acta.conciliadorEmail})</span>}
                </p>
                <p className="card-meta">
                  <span className="estado-badge estado-pendiente">{estadoPorId.get(acta.estadoActaId)?.nombre ?? "—"}</span>
                </p>
              </div>
              <div className="btn-group">
                <button type="button" className="btn-sm primary" onClick={() => setVinculando(acta)}>
                  🔗 Vincular a carpeta
                </button>
              </div>
            </div>
          </article>
        );
      })}

      {cargando && (
        <NuevaActaModal
          onClose={() => setCargando(false)}
          onSaved={() => {
            setCargando(false);
            actas.reload();
          }}
        />
      )}
      {vinculando && (
        <VincularActaModal
          acta={vinculando}
          tipoCodigo={tipoPorId.get(vinculando.tipoActaId)?.codigo}
          carpetas={carpetas.data ?? []}
          onClose={() => setVinculando(null)}
          onLinked={(carpetaId) => {
            setVinculando(null);
            actas.reload();
            setCarpetaAbierta(carpetaId);
          }}
        />
      )}
      {carpetaAbierta && <CarpetaDetalle id={carpetaAbierta} onClose={() => setCarpetaAbierta(null)} />}
    </section>
  );
}

function NuevaActaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { catalogos, toast } = useApp();
  const [form, setForm] = useState({
    expediente: "",
    tipoActaId: catalogos.tiposActa[0]?.id ?? 0,
    estadoActaId: catalogos.estadosActa[0]?.id ?? 0,
    conciliadorNombre: "",
    conciliadorEmail: "",
    fecha: "",
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
      await crearActa({
        expediente: form.expediente.trim() || null,
        tipoActaId: form.tipoActaId,
        estadoActaId: form.estadoActaId,
        conciliadorNombre: form.conciliadorNombre.trim() || null,
        conciliadorEmail: form.conciliadorEmail.trim() || null,
        fecha: form.fecha || null,
      });
      toast("Acta cargada en la bandeja");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Cargar acta"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="form-acta" className="primary" disabled={saving}>
            {saving ? "Guardando…" : "Cargar"}
          </button>
        </>
      }
    >
      <form id="form-acta" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <div className="form-grid-2">
          <div className="form-row">
            <label htmlFor="ac-expediente">Expediente</label>
            <input id="ac-expediente" type="text" value={form.expediente} onChange={set("expediente")} />
          </div>
          <div className="form-row">
            <label htmlFor="ac-fecha">Fecha</label>
            <input id="ac-fecha" type="date" value={form.fecha} onChange={set("fecha")} />
          </div>
          <div className="form-row">
            <label htmlFor="ac-tipo">Tipo</label>
            <select id="ac-tipo" value={form.tipoActaId} onChange={set("tipoActaId")}>
              {catalogos.tiposActa.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="ac-estado">Estado</label>
            <select id="ac-estado" value={form.estadoActaId} onChange={set("estadoActaId")}>
              {catalogos.estadosActa.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="ac-concil">Conciliador/a</label>
            <input id="ac-concil" type="text" value={form.conciliadorNombre} onChange={set("conciliadorNombre")} />
          </div>
          <div className="form-row">
            <label htmlFor="ac-concil-email">Email del conciliador</label>
            <input id="ac-concil-email" type="email" value={form.conciliadorEmail} onChange={set("conciliadorEmail")} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function VincularActaModal({
  acta,
  tipoCodigo,
  carpetas,
  onClose,
  onLinked,
}: {
  acta: Acta;
  tipoCodigo: string | undefined;
  carpetas: Carpeta[];
  onClose: () => void;
  onLinked: (carpetaId: string) => void;
}) {
  const { toast } = useApp();
  // Sugerencia: carpeta con el mismo expediente que el acta.
  const sugerida = carpetas.find(
    (c) => acta.expediente && c.expediente.trim().toLowerCase() === acta.expediente.trim().toLowerCase(),
  );
  const [carpetaId, setCarpetaId] = useState(sugerida?.id ?? "");
  const [audiencias, setAudiencias] = useState<Audiencia[] | null>(null);
  const [audienciaId, setAudienciaId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAudiencias(null);
    setAudienciaId("");
    if (!carpetaId) return;
    let alive = true;
    fetchAudienciasDeCarpeta(carpetaId).then(
      (list) => {
        if (!alive) return;
        const pendientes = list.filter((a) => a.estado === "pendiente");
        setAudiencias(pendientes);
        if (pendientes.length === 1) setAudienciaId(pendientes[0].id);
      },
      (err) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [carpetaId]);

  async function confirmar() {
    setSaving(true);
    setError(null);
    try {
      await vincularActa(acta.id, carpetaId, audienciaId);
      toast("Acta vinculada · carpeta actualizada");
      onLinked(carpetaId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Vincular acta a carpeta"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="primary" disabled={!carpetaId || !audienciaId || saving} onClick={confirmar}>
            {saving ? "Vinculando…" : "Vincular"}
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <div className="info-box">
        Acta Expte. {acta.expediente ?? "sin número"}. {EFECTO_POR_TIPO[tipoCodigo ?? ""] ?? "La carpeta queda En trámite"}, la
        audiencia elegida se marca como realizada y queda registrado en la bitácora.
      </div>
      <div className="form-row">
        <label htmlFor="vin-carpeta">Carpeta {sugerida && <span className="badge info">sugerida por expediente</span>}</label>
        <select id="vin-carpeta" value={carpetaId} onChange={(e) => setCarpetaId(e.target.value)}>
          <option value="">Elegí una carpeta…</option>
          {carpetas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.caratula} · Expte. {c.expediente}
            </option>
          ))}
        </select>
      </div>
      {carpetaId && (
        <div className="form-row">
          <label htmlFor="vin-audiencia">Audiencia que cierra el acta</label>
          {audiencias === null ? (
            <Loading label="Buscando audiencias pendientes…" />
          ) : audiencias.length === 0 ? (
            <div className="warn-box">Esta carpeta no tiene audiencias pendientes. Agendá una desde la carpeta para poder vincular.</div>
          ) : (
            <select id="vin-audiencia" value={audienciaId} onChange={(e) => setAudienciaId(e.target.value)}>
              <option value="">Elegí la audiencia…</option>
              {audiencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {fmtDate(a.fecha)} {fmtHora(a.hora)} · {a.tipoNombre ?? "Audiencia"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </Modal>
  );
}
