// ─────────────────────────────────────────────────────────────────────────────
// src/App.jsx
// Punto de entrada: decide si mostrar Login o el sistema de inventario
// ─────────────────────────────────────────────────────────────────────────────
import { Box } from "lucide-react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login          from "./components/Login";
import InventoryApp   from "./InventorySystem";

function AppContent() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-500 rounded-xl animate-pulse mb-4">
            <Box size={22} className="text-slate-900" />
          </div>
          <p className="text-sm text-slate-500">Cargando Invenxio…</p>
        </div>
      </div>
    );
  }

  return currentUser ? <InventoryApp /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
