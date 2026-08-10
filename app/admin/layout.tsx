import { getCurrentUser } from "@/backend/lib/auth";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/frontend/components/admin/AdminSidebar";
import { AdminHeader } from "@/frontend/components/admin/AdminHeader";
import type { ReactNode } from "react";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#070b14]">
      <AdminSidebar />
      <main className="lg:pl-[260px]">
        <AdminHeader userName={user.name} />
        <div className="min-w-0 px-4 py-6 sm:py-8 md:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}