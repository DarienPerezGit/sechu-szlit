import { useState, type FormEvent } from "react";
import {
  actualizarIntegrante,
  crearIntegrante,
  fetchEquipoCompleto,
  type MiembroEquipo,
} from "../lib/domain";
import { ErrorBox, Loading, Modal, PERFIL_LABEL, errorMessage, useApp, useAsync } from "../components/ui";

type PerfilElegido = "titular" | "abogado" | "asistente";

const perfilDe = (m: MiembroEquipo): PerfilElegido | null =>
  m.rol === "abogado" ? (m.esTitular ? "titular" : "abogado") : m.rol === "asistente" ? "asistente" : null;

/** Cómo se guarda cada perfil: el titular es un abogado con permiso extra. */
const comoSeGuarda = (p: PerfilElegido) =>
  p === "asistente" ? { rol: "asistente" as const, esTitular: false } : { rol: "abogado" as const, esTitular: p === "titular" };

/**
 * Administración del equipo (solo el titular): alta de integrantes, cambio de
 * perfil y bajas. La API impide dejar al estudio sin un titular activo.
 */
export function EquipoView() {
  const { userId, toast } = useApp();
  const equipo = useAsync(fetchEquipoCompleto, []);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  async function cambiar(m: MiembroEquipo, cambios: Parameters<typeof actualizarIntegrante>[1], aviso: string) {
    setGuardando(m.id);
    setError(null);
    try {
      await actualizarIntegrante(m.id, cambios);
      toast(aviso);
      equipo.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(null);
    }
  }

  return (
    <section aria-label="Equipo">
      <div className="row-flex section-head">
        <p className="hint">
          Quién trabaja en el estudio y con qué perfil. El abogado ve sus carpetas, el asistente ve todo y vincula
          actas, y el titular además administra el equipo.
        </p>
        <button type="button" className="primary" onClick={() => setCreando(true)}>
          ➕ Dar de alta
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {equipo.error ? <ErrorBox error={equipo.error} onRetry={equipo.reload} /> : null}
      {!equipo.data && !equipo.error && <Loading />}

      {equipo.data && (
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Integrante</th>
              <th scope="col">Perfil</th>
              <th scope="col">Estado</th>
              <th scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {equipo.data.map((m) => {
              const actual = perfilDe(m);
              const ocupado = guardando === m.id;
              return (
                <tr key={m.id} className={m.activo === false ? "inactivo" : undefined}>
                  <td>
                    {m.email}
                    {m.id === userId && <span className="small muted"> (vos)</span>}
                  </td>
                  <td>
                    <select
                      aria-label={`Perfil de ${m.email}`}
                      value={actual ?? ""}
                      disabled={ocupado || m.activo === false}
                      onChange={(e) => {
                        const nuevo = e.target.value as PerfilElegido;
                        cambiar(m, comoSeGuarda(nuevo), `${m.email} ahora es ${PERFIL_LABEL[nuevo].toLowerCase()}`);
                      }}
                    >
                      {actual === null && <option value="">Sin perfil</option>}
                      <option value="titular">{PERFIL_LABEL.titular}</option>
                      <option value="abogado">{PERFIL_LABEL.abogado}</option>
                      <option value="asistente">{PERFIL_LABEL.asistente}</option>
                    </select>
                  </td>
                  <td>{m.activo === false ? "Dado de baja" : "Activo"}</td>
                  <td>
                    {m.activo === false ? (
                      <button type="button" className="btn-sm" disabled={ocupado} onClick={() => cambiar(m, { activo: true }, `${m.email} volvió a estar activo`)}>
                        Reactivar
                      </button>
                    ) : (
                      <button type="button" className="btn-sm danger" disabled={ocupado} onClick={() => cambiar(m, { activo: false }, `${m.email} fue dado de baja`)}>
                        Dar de baja
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {creando && (
        <AltaIntegrante
          onClose={() => setCreando(false)}
          onCreated={(email) => {
            setCreando(false);
            toast(`${email} ya puede iniciar sesión`);
            equipo.reload();
          }}
        />
      )}
    </section>
  );
}

function AltaIntegrante({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perfil, setPerfil] = useState<PerfilElegido>("abogado");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const creado = await crearIntegrante({ email: email.trim(), password, ...comoSeGuarda(perfil) });
      onCreated(creado.email);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Dar de alta a un integrante"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="form-alta" className="primary" disabled={saving || !email || password.length < 8}>
            {saving ? "Creando cuenta…" : "Dar de alta"}
          </button>
        </>
      }
    >
      <form id="form-alta" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <div className="form-row">
          <label htmlFor="alta-email">Email</label>
          <input id="alta-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-grid-2">
          <div className="form-row">
            <label htmlFor="alta-password">Contraseña inicial</label>
            <input
              id="alta-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="small muted">Mínimo 8 caracteres. Pasásela a la persona por un canal privado.</p>
          </div>
          <div className="form-row">
            <label htmlFor="alta-perfil">Perfil</label>
            <select id="alta-perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilElegido)}>
              <option value="abogado">{PERFIL_LABEL.abogado}: sus carpetas y su agenda</option>
              <option value="asistente">{PERFIL_LABEL.asistente}: todo el estudio, agenda y actas</option>
              <option value="titular">{PERFIL_LABEL.titular}: todo, más el equipo</option>
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}
