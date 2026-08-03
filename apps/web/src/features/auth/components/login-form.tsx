"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { OsherLogo } from "@/components/brand/osher-logo";

// Gate visual do botao. Nao e validacao de credencial — quem valida e o
// authorize() do Auth.js (bcrypt + status do usuario). So exigimos e-mail
// plausivel e senha preenchida, para nao travar login de senha existente por
// regra de UI. Regex em vez de Zod de proposito: o Zod no cliente custava
// ~13kB de JS nesta pagina, que e justamente a de carga fria.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = EMAIL_PATTERN.test(email.trim()) && password.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false
    });

    setIsSubmitting(false);

    if (result?.error) {
      setError("E-mail ou senha inválidos.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <section
      aria-label="Acesso OSHER"
      className="osher-glass osher-glass--sheen osher-card osher-card--rise"
    >
      <div className="mb-[22px] flex items-center gap-[13px]">
        <OsherLogo className="osher-brand-mark" variant="mark" />
        <span className="osher-brand-name">OSHER</span>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="osher-label mb-2" htmlFor="email">
            E-mail
          </label>
          <div className="osher-focus-wrap">
            <input
              autoComplete="username"
              className="osher-input"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@osher.com.br"
              type="email"
              value={email}
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="osher-label mb-2" htmlFor="password">
            Senha
          </label>
          <div className="osher-focus-wrap relative">
            <input
              autoComplete="current-password"
              className="osher-input osher-input--with-action"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="osher-pass-toggle"
              onClick={() => setShowPassword((current) => !current)}
              type="button"
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="osher-alert mt-4" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-[22px]">
          <button
            className="osher-btn"
            disabled={!canSubmit || isSubmitting}
            type="submit"
          >
            <span>{isSubmitting ? "Verificando…" : "Entrar"}</span>
            <svg
              aria-hidden="true"
              className="osher-arrow"
              fill="none"
              height="16"
              viewBox="0 0 16 16"
              width="16"
            >
              <path
                d="M3 8h9M8.5 4l4 4-4 4"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

export default LoginForm;
