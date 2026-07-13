import { redirect } from "next/navigation";
import { getCurrentUser } from "@/backend/lib/auth";
import { LayoutShell } from "./LayoutShell";

export async function AppShell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth");
  if (admin && user.role !== "admin") redirect("/dashboard");

  return (
    <LayoutShell
      userName={user.name}
      userRole={user.role}
      isAdmin={user.role === "admin"}
    >
      {children}
    </LayoutShell>
  );
}
