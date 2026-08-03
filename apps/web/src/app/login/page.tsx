import { AuthBackground } from "@/features/auth/components/auth-background";
import { AuthCardTilt } from "@/features/auth/components/auth-card-tilt";
import { LoginForm } from "@/features/auth/components/login-form";

// Server Component: so a composicao. Os pedacos interativos (fundo, tilt e
// formulario) sao client components isolados.
export default function LoginPage() {
  return (
    <main className="osher-auth-root">
      <AuthBackground />
      <AuthCardTilt>
        <LoginForm />
      </AuthCardTilt>
    </main>
  );
}
