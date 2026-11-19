import { describe, expect, it } from "vitest";
import type { Audiencia, MiembroEquipo } from "../lib/domain";
import {
  agendaPara,
  puedeCrearCarpeta,
  puedeEditarAudiencia,
  puedeEditarCarpeta,
  puedeReasignarAudiencia,
  puedeVerCarpeta,
} from "./ui";

const YO = "u-yo";
const OTRO = "u-otro";
const equipo: MiembroEquipo[] = [
  { id: YO, email: "yo@test.com", rol: "abogado", esTitular: false },
  { id: OTRO, email: "otro@test.com", rol: "abogado", esTitular: false },
];
const ctx = (perfil: "titular" | "abogado" | "asistente") => ({ perfil, userId: YO, equipo });
const audiencia = (abogadoId: string, carpetaAbogadoResponsableId: string | null): Audiencia => ({
  id: "a-1", carpetaId: carpetaAbogadoResponsableId ? "c-1" : null, abogadoId, fecha: "2026-12-01", hora: "10:00:00",
  estado: "pendiente", tipoAudienciaId: 1, linkReunion: null, notasInternas: null, abogadoEmail: null,
  tipoNombre: null, tipoColor: null, carpetaAbogadoResponsableId,
});

describe("reglas de pantalla por perfil (espejo de la API)", () => {
  it("el asistente no abre ni edita carpetas; el abogado solo las suyas", () => {
    expect(puedeCrearCarpeta(ctx("asistente"))).toBe(false);
    expect(puedeCrearCarpeta(ctx("abogado"))).toBe(true);
    expect(puedeEditarCarpeta(ctx("abogado"), { abogadoResponsableId: OTRO })).toBe(false);
    expect(puedeEditarCarpeta(ctx("abogado"), { abogadoResponsableId: YO })).toBe(true);
    expect(puedeEditarCarpeta(ctx("titular"), { abogadoResponsableId: OTRO })).toBe(true);
    expect(puedeEditarCarpeta(ctx("asistente"), { abogadoResponsableId: OTRO })).toBe(false);
  });

  it("quien cubre a un colega ve la audiencia pero no puede abrir su carpeta", () => {
    const cubierta = audiencia(YO, OTRO);
    expect(puedeEditarAudiencia(ctx("abogado"), cubierta)).toBe(true);
    expect(puedeVerCarpeta(ctx("abogado"), { abogadoResponsableId: cubierta.carpetaAbogadoResponsableId })).toBe(false);
    expect(puedeVerCarpeta(ctx("asistente"), { abogadoResponsableId: OTRO })).toBe(true);
  });

  it("el responsable edita las audiencias de su carpeta aunque asista otro; nadie más", () => {
    expect(puedeEditarAudiencia(ctx("abogado"), audiencia(OTRO, YO))).toBe(true);
    expect(puedeEditarAudiencia(ctx("abogado"), audiencia(OTRO, OTRO))).toBe(false);
  });

  it("reasignar y agendar para otro pasa por el titular o procuración", () => {
    expect(puedeReasignarAudiencia(ctx("abogado"))).toBe(false);
    expect(puedeReasignarAudiencia(ctx("asistente"))).toBe(true);
    expect(puedeReasignarAudiencia(ctx("titular"))).toBe(true);
    expect(agendaPara(ctx("abogado")).map((m) => m.id)).toEqual([YO]);
    expect(agendaPara(ctx("asistente")).map((m) => m.id)).toEqual([YO, OTRO]);
  });
});
