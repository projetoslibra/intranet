import { DashboardShell } from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { getCurrentUserPermissions } from "@/lib/permissions";
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

  const permissions = await getCurrentUserPermissions();

  return (
    <DashboardShell
      permissions={Array.from(permissions)}
      user={{
        name: session.user.name ?? "Usuario OSHER",
        email: session.user.email ?? "",
        role: session.user.role ?? "LEITURA",
      }}
    >
      {children}
    </DashboardShell>
  );
}
