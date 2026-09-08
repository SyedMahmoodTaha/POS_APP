import { HashRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useEffect } from "react"
import {Home, Auth, NewOrder, Orders, Settings, BillPrintingPreferences, AdminSettings, Developer, SqliteDbViewer} from './pages'
import Header from "./components/shared/header"
import Tables from "./pages/Tables"
import { getCurrentUser } from "./utils/auth"
import { hydrateOrdersFromDb } from "./utils/orderStorage"
function App() {
  useEffect(() => {
    const hydrate = async () => {
      if (!window.pflDesktop || !window.pflDesktop.getOrders) return;
      const wasCleaned = await window.pflDesktop.prepareCleanWindowsData?.();
      if (wasCleaned) {
        localStorage.removeItem("pfl-orders-v2");
        localStorage.removeItem("pfl-bill-sequence-v2");
      }
      await hydrateOrdersFromDb();
    };
    void hydrate();
  }, [])

  return (
    <>
      <Router>
        <AppRoutes />
      </Router>
    </>
  )
}

function AppRoutes() {
  const location = useLocation()
  const isAuthenticated = Boolean(getCurrentUser())
  const currentUser = getCurrentUser()

  if (!isAuthenticated && location.pathname !== "/Auth") {
    return <Navigate to="/Auth" state={{ from: location.pathname }} replace />
  }

  return (
    <>
      {isAuthenticated && location.pathname === "/" && <Header />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new-order" element={<NewOrder />} />
        <Route path="/Auth" element={<Auth />} />
        <Route path="/Tables" element={<Tables />} />
        <Route path="/Orders" element={<Orders />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/bill-printing-preferences" element={<BillPrintingPreferences />} />
        <Route path="/admin-settings" element={currentUser?.role === "Admin" ? <AdminSettings /> : <Navigate to="/" replace />} />
        <Route path="/developer" element={<Developer />} />
        <Route path="/sqlite-db-viewer" element={currentUser?.role === "Admin" ? <SqliteDbViewer /> : <Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
