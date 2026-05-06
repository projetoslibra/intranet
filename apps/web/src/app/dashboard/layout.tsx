import { DashboardShell } from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell
      user={{
        name: session.user.name ?? "Usuário OSHER",
        email: session.user.email ?? "",
        role: session.user.role ?? "LEITURA",
      }}
    >
      {children}
    </DashboardShell>
  );
}
