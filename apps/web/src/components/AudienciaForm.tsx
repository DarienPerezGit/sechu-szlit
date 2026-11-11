import { useState, type FormEvent } from "react";
import { crearAudiencia, type Carpeta } from "../lib/domain";
import { toYmd } from "../lib/format";
import { Modal, errorMessage, useApp } from "./ui";

/**
 * Alta de audiencia. Con `carpeta` queda vinculada a ese caso; sin ella se
 * puede elegir una carpeta o dejarla sin carpeta (bloqueo de fecha → bandeja).
 */
export function AudienciaForm({
  carpeta,
  carpetas = [],
  fechaInicial,
  onClose,
  onSaved,
}: {
  carpeta?: Carpeta;
  carpetas?: Carpeta[];
  fechaInicial?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { catalogos, equipo, userId, toast } = useApp();
  const [fecha, setFecha] = useState(fechaInicial ?? toYmd(new Date()));
  const [hora, setHora] = useState("10:00");
  const [tipoId, setTipoId] = useState(catalogos.tiposAudiencia[0]?.id ?? 0);
  const [abogadoId, setAbogadoId] = useState(
    equipo.some((m) => m.id === userId) ? userId : equipo[0]?.id ?? "",
  );
  const [carpetaId, setCarpetaId] = useState(carpeta?.id ?? "");
  const [link, setLink] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await crearAudiencia({
        carpetaId: carpetaId || null,
        abogadoId,
        fecha,
        hora,
        tipoAudienciaId: Number(tipoId),
        linkReunion: link.trim() || null,
        notasInternas: notas.trim() || null,
      });
      toast("Audiencia agendada");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={carpeta ? `Agendar audiencia · ${carpeta.caratula}` : "Nueva audiencia"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="form-audiencia" className="primary" disabled={saving || !fecha || !abogadoId}>
            {saving ? "Guardando…" : "Agendar"}
          </button>
        </>
      }
    >
      <form id="form-audiencia" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <div className="form-grid-2">
          <div className="form-row">
            <label htmlFor="aud-fecha">Fecha</label>
            <input id="aud-fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="aud-hora">Hora</label>
            <input id="aud-hora" type="time" required value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="aud-tipo">Tipo</label>
            <select id="aud-tipo" value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}>
              {catalogos.tiposAudiencia.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="aud-abogado">Abogado/a</label>
            <select id="aud-abogado" required value={abogadoId} onChange={(e) => setAbogadoId(e.target.value)}>
              {equipo.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!carpeta && (
          <div className="form-row">
            <label htmlFor="aud-carpeta">Carpeta</label>
            <select id="aud-carpeta" value={carpetaId} onChange={(e) => setCarpetaId(e.target.value)}>
              <option value="">Sin carpeta (bloquear fecha, se vincula después)</option>
              {carpetas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caratula} · Expte. {c.expediente}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label htmlFor="aud-link">Link de reunión (opcional)</label>
          <input id="aud-link" type="url" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="aud-notas">Notas internas (opcional)</label>
          <textarea id="aud-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
