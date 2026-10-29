import { AdminShell } from "@/components/AdminShell";
import { AdminProvider } from "@/lib/admin-store";

export const metadata = { title: "Investa · Backoffice MCA" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}
