import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";
import { setSupabaseClient } from "../lib/supabase";
import { createFakeSupabaseClient } from "../test-helpers/fake-supabase";

function fillAndSubmit(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText(/Correo electrónico/), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/Contraseña/), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /Ingresar/ }));
}

afterEach(() => {
  setSupabaseClient(null);
  vi.restoreAllMocks();
});

describe("Login", () => {
  it("renders email and password fields (no local credential API)", () => {
    createFakeSupabaseClient({
      signInResult: { data: {}, error: null },
    });

    render(<Login onSuccess={vi.fn()} />);

    expect(screen.getByLabelText(/Correo electrónico/).getAttribute("type")).toBe(
      "email",
    );
    expect(screen.getByLabelText(/Contraseña/).getAttribute("type")).toBe(
      "password",
    );
  });

  it("shows the notice above the form when provided", () => {
    createFakeSupabaseClient({ signInResult: { data: {}, error: null } });

    render(
      <Login notice="Tu sesión expiró. Iniciá sesión nuevamente." onSuccess={vi.fn()} />,
    );

    expect(
      screen.getByText("Tu sesión expiró. Iniciá sesión nuevamente."),
    ).toBeTruthy();
  });

  it("maps Supabase credential failures to a Spanish message and stays on login", async () => {
    const { signInWithPassword } = createFakeSupabaseClient({
      signInResult: {
        data: { user: null, session: null },
        error: { message: "Invalid login credentials", status: 400 },
      },
    });
    const onSuccess = vi.fn();

    render(<Login onSuccess={onSuccess} />);
    fillAndSubmit("user@estudio.com", "wrong-password");

    await waitFor(() => {
      expect(
        screen.getByRole("alert").textContent,
      ).toContain("Correo o contraseña incorrectos.");
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@estudio.com",
      password: "wrong-password",
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onSuccess after a successful sign-in without an error state", async () => {
    const { signInWithPassword } = createFakeSupabaseClient({
      signInResult: { data: { user: {}, session: {} }, error: null },
    });
    const onSuccess = vi.fn();

    render(<Login onSuccess={onSuccess} />);
    fillAndSubmit("user@estudio.com", "correct-password");

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
