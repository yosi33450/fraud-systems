"use client";

import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleUserRound,
  ClipboardList,
  ExternalLink,
  FileClock,
  Filter,
  Fingerprint,
  Gauge,
  Gift,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  Menu,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  PlusCircle,
  Phone,
  RefreshCcw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  MapPin,
  Wifi,
  CreditCard,
  Sparkles,
  SlidersHorizontal,
  Store as StoreIcon,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SeverityBadge } from "@/components/severity-badge";
import { GiftCardWorkspace } from "@/components/gift-card-workspace";
import { CenteredDialog } from "@/components/centered-dialog";
import { SidebarItem, useWorkspaceNavigation } from "@/components/workspace-navigation";
import { createSnapshotRefresh } from "@/lib/snapshot-refresh";
import { summarizeGiftCluster, type MoneyTotal } from "@/lib/gift-cluster-summary";
import type { GiftLedger } from "@/lib/gift-card-evidence";
import { cases as initialCases, employees, rules, stores } from "@/lib/initial-state";
import type { BlacklistReport, CaseStatus, DashboardSnapshot, Employee, EmployeeDiscountActivity, EmployeeMonitoringSettings, FraudCase, NotificationDelivery, NotificationSettings, RiskCondition, RiskConditionField, RiskRule, Severity, Store } from "@/lib/types";

type View = "overview" | "cases" | "gift-cards" | "stores" | "employees" | "rules" | "notifications" | "network" | "team" | "platform";
type RuleReconciliation = { reviewed: number; updated: number; resolved: number; reopened: number; active: number };

const nav = [
  { id: "overview", label: "מרכז בקרה", Icon: LayoutDashboard },
  { id: "cases", label: "התראות וחקירות", Icon: ClipboardList, count: 8 },
  { id: "gift-cards", label: "מעקב גיפטקארדים", Icon: Gift },
  { id: "stores", label: "חנויות", Icon: StoreIcon },
  { id: "employees", label: "עובדים", Icon: UsersRound },
  { id: "rules", label: "חוקי סיכון", Icon: SlidersHorizontal },
  { id: "notifications", label: "התראות אימייל", Icon: Mail },
  { id: "network", label: "המאגר המשותף", Icon: Network },
  { id: "team", label: "צוות והרשאות", Icon: UserRoundCog },
] satisfies { id: View; label: string; Icon: typeof LayoutDashboard; count?: number }[];

const statusLabels: Record<CaseStatus, string> = {
  new: "חדש",
  review: "בבדיקה",
  action: "דורש פעולה",
  fraud: "הונאה מאומתת",
  "false-positive": "לא חשוד",
  resolved: "נסגר",
};

const isAutomaticallyResolved = (item: FraudCase) => item.status === "resolved" && (item.resolution?.source === "automatic-rule-change" || item.reason === "לא עומד עוד בחוקי הסיכון הפעילים");
const caseStatusLabel = (item: FraudCase) => isAutomaticallyResolved(item) ? "נסגר אוטומטית" : item.status === "resolved" ? "נסגר ידנית" : statusLabels[item.status];
const isPayPlusPlaceholder = (item: FraudCase) => /general customer payplus/i.test(item.customer) || /עסקת PayPlus/i.test(item.email);
const customerDisplayName = (item: FraudCase) => {
  if (isPayPlusPlaceholder(item)) return "פרטי הקונה לא הועברו";
  if (!["ללא שם", "לקוח Shopify", ""].includes(item.customer.trim())) return item.customer;
  if (item.context?.phone) return "לקוח מזוהה לפי טלפון";
  if (item.email.includes("@")) return item.email;
  return "פרטי הקונה לא הועברו";
};

const sourceLabels = { network: "רשת", shopify: "Shopify", behavior: "התנהגות", employee: "עובדים" };

const formatCurrency = (value: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
const tenantId = "tenant-primary";

export function FraudCommandCenter() {
  const [view, setView] = useState<View>("overview");
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [view]);
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);
  const [decisionNotice, setDecisionNotice] = useState("");
  const [decisionVersion, setDecisionVersion] = useState(0);
  const [caseData, setCaseData] = useState(initialCases);
  const [giftLedger, setGiftLedger] = useState<DashboardSnapshot["giftCardLedger"]>();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [store, setStore] = useState("all");
  const [ruleData, setRuleData] = useState(rules);
  const [storeData, setStoreData] = useState<Store[]>(stores);
  const [employeeData, setEmployeeData] = useState<Employee[]>(employees);
  const [employeeDiscountActivity, setEmployeeDiscountActivity] = useState<EmployeeDiscountActivity>({ prefix: "", ordersChecked: 0, ordersWithAnyDiscountCode: 0, totalOrders: 0, totalAmount: 0, codes: [], recentUses: [] });
  const [employeeSettings, setEmployeeSettings] = useState<EmployeeMonitoringSettings>({ tenantId, couponPrefix: "", zeroAmount: true, giftCardAddressChange: true, repeatGiftCardUses: true, repeatUsesThreshold: 3, windowMinutes: 1440 });
  const [reports, setReports] = useState<BlacklistReport[]>([]);
  const [notifications, setNotifications] = useState<NotificationSettings>({ tenantId, enabled: false, recipients: [], severities: ["critical", "high"], reminderMinutes: 30 });
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [syncState, setSyncState] = useState<"loading" | "live" | "error" | "expired">("loading");
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const snapshotRefresh = useRef<ReturnType<typeof createSnapshotRefresh<DashboardSnapshot>> | null>(null);
  const refreshContext = useRef({ view, selectedCase, connectOpen: false, syncing: true });
  const [mobileNav, setMobileNav] = useState(false);
  const { collapsed, toggleCollapsed } = useWorkspaceNavigation(mobileNav, setMobileNav);
  const [connectOpen, setConnectOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const realtimeActive = storeData.some((item) => item.realtimeStatus === "active");
  const realtimeRegistered = storeData.some((item) => item.realtimeStatus === "registered");
  const realtimeNeedsSetup = storeData.some((item) => !["active", "registered"].includes(item.realtimeStatus ?? "setup-required"));

  const visibleCases = useMemo(() => caseData.filter((item) => {
    const searchMatch = deferredQuery.length === 0 || [item.orderNumber, item.customer, item.email, item.reason].some((value) => value.toLowerCase().includes(deferredQuery));
    return searchMatch && (severity === "all" || item.severity === severity) && (store === "all" || item.storeId === store);
  }), [caseData, deferredQuery, severity, store]);

  const applySnapshot = (snapshot: DashboardSnapshot) => {
    setCaseData(snapshot.cases);
    setGiftLedger(snapshot.giftCardLedger);
    setStoreData(snapshot.stores);
    setEmployeeData(snapshot.employees);
    setEmployeeDiscountActivity(snapshot.employeeDiscountActivity ?? { prefix: "", ordersChecked: 0, ordersWithAnyDiscountCode: 0, totalOrders: 0, totalAmount: 0, codes: [], recentUses: [] });
    if (snapshot.employeeSettings) setEmployeeSettings(snapshot.employeeSettings);
    setRuleData(snapshot.rules);
    setReports(snapshot.reports);
    setNotifications(snapshot.notifications);
    setDeliveries(snapshot.deliveries);
    setSyncState("live");
  };

  const refreshSnapshot = async () => { await snapshotRefresh.current?.refresh(); };

  useEffect(() => {
    refreshContext.current = { view, selectedCase, connectOpen, syncing: syncState === "loading" };
  }, [view, selectedCase, connectOpen, syncState]);

  useEffect(() => {
    const refresher = createSnapshotRefresh<DashboardSnapshot>({
      load: async (signal) => {
        const response = await fetch(`/api/tenants/${tenantId}/snapshot`, { cache: "no-store", signal });
        if (response.status === 401) throw new Error("SESSION_EXPIRED");
        if (!response.ok) throw new Error("SNAPSHOT_FAILED");
        return await response.json() as DashboardSnapshot;
      },
      apply: applySnapshot,
      state: setSyncState,
      canRefresh: () => {
        const context = refreshContext.current;
        return document.visibilityState === "visible" && navigator.onLine
          && ["overview", "cases", "gift-cards", "stores", "employees"].includes(context.view)
          && !context.selectedCase && !context.connectOpen && !context.syncing
          && !document.querySelector('[role="dialog"], dialog[open]')
          && !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
      },
    });
    snapshotRefresh.current = refresher;
    void refresher.refresh();
    const refreshQuietly = () => { void refresher.refresh(true); };
    const interval = window.setInterval(refreshQuietly, 30_000);
    window.addEventListener("focus", refreshQuietly);
    window.addEventListener("online", refreshQuietly);
    document.addEventListener("visibilitychange", refreshQuietly);
    // Discard background results when the user starts an action (including mutations).
    const interrupt = () => { if (snapshotRefresh.current === refresher) refresher.interrupt(); };
    document.addEventListener("pointerdown", interrupt, true);
    document.addEventListener("keydown", interrupt, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshQuietly);
      window.removeEventListener("online", refreshQuietly);
      document.removeEventListener("visibilitychange", refreshQuietly);
      document.removeEventListener("pointerdown", interrupt, true);
      document.removeEventListener("keydown", interrupt, true);
      refresher.cancel();
      snapshotRefresh.current = null;
    };
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "gift-cards") setView("gift-cards");
  }, []);

  const decideCase = async (status: CaseStatus, includeRelated = false) => {
    if (!selectedCase) return;
    const previous = selectedCase;
    setCaseData((current) => current.map((item) => item.id === selectedCase.id ? { ...item, status } : item));
    setSelectedCase((current) => current ? { ...current, status } : current);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/cases/${selectedCase.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, includeRelated }),
      });
      if (!response.ok) throw new Error("CASE_UPDATE_FAILED");
      const payload = await response.json() as { case: FraudCase; cases?: FraudCase[]; shopifyBlock?: "not-needed" | "tagged" | "pending" };
      const updated = [payload.case, ...(payload.cases ?? [])];
      const byId = new Map(updated.map((item) => [item.id, item]));
      setCaseData((current) => current.map((item) => byId.get(item.id) ?? item));
      if (status === "fraud") {
        setSelectedCase(null);
        setDecisionVersion((value) => value + 1);
        setDecisionNotice(`${updated.length} ${updated.length === 1 ? "הזמנה סומנה" : "הזמנות סומנו"} כהונאה וזיהויי הלקוחות נוספו למאגר ההתאמות.${payload.shopifyBlock === "tagged" ? " הלקוח סומן גם ב־Shopify." : payload.shopifyBlock === "pending" ? " סימון הלקוח ב־Shopify טרם הושלם." : ""} המאגר מתריע בלבד ואינו חוסם תשלום.`);
        void refreshSnapshot();
      } else {
        setSelectedCase(payload.case);
        setDecisionNotice("סטטוס התיק עודכן.");
      }
    } catch {
      setCaseData((current) => current.map((item) => item.id === previous.id ? previous : item));
      setSelectedCase(previous);
      setDecisionNotice("עדכון התיק נכשל. נסה שוב.");
      setSyncState("error");
    }
  };

  const openCase = (item: FraudCase) => {
    setDecisionNotice("");
    setSelectedCase(item);
  };

  const toggleRule = async (rule: RiskRule) => {
    const enabled = !rule.enabled;
    setRuleData((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
    try {
      const response = await fetch(`/api/tenants/${tenantId}/rules/${rule.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { rule: RiskRule; cases: FraudCase[]; reconciliation: RuleReconciliation };
      setRuleData((current) => current.map((item) => item.id === payload.rule.id ? payload.rule : item));
      setCaseData(payload.cases);
      return payload.reconciliation;
    } catch {
      setRuleData((current) => current.map((item) => item.id === rule.id ? rule : item));
      setSyncState("error");
      throw new Error("RULE_UPDATE_FAILED");
    }
  };

  const createEmployee = async (input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) => {
    const response = await fetch(`/api/tenants/${tenantId}/employees`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("EMPLOYEE_CREATE_FAILED");
    const payload = await response.json() as { employee: Employee };
    setEmployeeData((current) => [payload.employee, ...current]);
    void refreshSnapshot();
  };
  const updateEmployeeProfile = async (id: string, input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) => {
    const response = await fetch(`/api/tenants/${tenantId}/employees/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("EMPLOYEE_UPDATE_FAILED");
    const payload = await response.json() as { employee: Employee };
    setEmployeeData((current) => current.map((employee) => employee.id === id ? payload.employee : employee));
    void refreshSnapshot();
    return payload.employee;
  };

  const saveEmployeeMonitoring = async (input: EmployeeMonitoringSettings) => {
    const response = await fetch(`/api/tenants/${tenantId}/employee-settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("EMPLOYEE_SETTINGS_FAILED");
    const payload = await response.json() as { settings: EmployeeMonitoringSettings };
    setEmployeeSettings(payload.settings);
    void refreshSnapshot();
  };

  const saveNotifications = async (next: NotificationSettings) => {
    const previous = notifications;
    setNotifications(next);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/notifications`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { notifications: NotificationSettings };
      setNotifications(payload.notifications);
    } catch {
      setNotifications(previous);
      setSyncState("error");
    }
  };

  const saveRule = async (rule: RiskRule) => {
    const response = await fetch(`/api/tenants/${tenantId}/rules/${rule.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
    });
    if (!response.ok) throw new Error("RULE_UPDATE_FAILED");
    const payload = await response.json() as { rule: RiskRule; cases: FraudCase[]; reconciliation: RuleReconciliation };
    setRuleData((current) => current.map((item) => item.id === payload.rule.id ? payload.rule : item));
    setCaseData(payload.cases);
    return payload.reconciliation;
  };

  const createRule = async (rule: Omit<RiskRule, "id" | "matches">) => {
    const response = await fetch(`/api/tenants/${tenantId}/rules`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
    });
    if (!response.ok) throw new Error("RULE_CREATE_FAILED");
    const payload = await response.json() as { rule: RiskRule; cases: FraudCase[] };
    setRuleData((current) => [payload.rule, ...current]);
    setCaseData(payload.cases);
  };

  const connectShopifyStore = async (input: { shopDomain: string; clientId: string; clientSecret: string }) => {
    const response = await fetch(`/api/tenants/${tenantId}/stores`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const payload = await response.json() as { connected?: boolean; store?: Store; sync?: { scanned: number; casesCreated: number }; error?: string };
    if (!response.ok || !payload.connected || !payload.store) throw new Error(payload.error ?? "SHOPIFY_CONNECTION_FAILED");
    await refreshSnapshot();
    setView("stores");
  };

  const syncShopifyStore = async (storeId: string) => {
    setSyncState("loading");
    setSyncProgress("מתחיל רענון של 30 יום…");
    try {
      let after: string | null = null;
      let scanned = 0;
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const seenCursors = new Set<string>();
      for (let page = 0; page < 1000; page += 1) {
        const response = await fetch(`/api/tenants/${tenantId}/stores/${storeId}/sync`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ since, after, scanned }),
        });
        const result = await response.json() as { scanned?: number; nextCursor?: string | null; complete?: boolean; error?: string };
        if (!response.ok || !Number.isSafeInteger(result.scanned)) throw new Error(result.error ?? "SHOPIFY_SYNC_FAILED");
        scanned = result.scanned!;
        setSyncProgress(`נבדקו ${scanned.toLocaleString("he-IL")} הזמנות…`);
        if (result.complete) break;
        if (!result.nextCursor || seenCursors.has(result.nextCursor) || page === 999) throw new Error("SHOPIFY_SYNC_CURSOR_FAILED");
        seenCursors.add(result.nextCursor);
        after = result.nextCursor;
      }
      await refreshSnapshot();
      setSyncProgress(null);
    } catch {
      setSyncState("error");
      setSyncProgress("הרענון נעצר לפני השלמה. ההזמנות שכבר נקלטו נשמרו; אפשר לנסות שוב.");
    }
  };

  const releaseBlock = async (caseId: string) => {
    const response = await fetch(`/api/tenants/${tenantId}/cases/${caseId}/block`, { method: "DELETE" });
    if (!response.ok) throw new Error("BLOCK_RELEASE_FAILED");
    await refreshSnapshot();
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">דלג לתוכן הראשי</a>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} id="primary-navigation" aria-label="ניווט ראשי">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Shield size={21} /></div>
          <div className="brand-copy"><strong>Shield Ledger</strong></div>
          <button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="סגירת תפריט"><X size={18} /></button>
        </div>
        <button className="tenant-switcher" onClick={() => { setView("stores"); setMobileNav(false); }} aria-label="ניהול החנויות שלי" title="ניהול החנויות שלי">
          <span className="tenant-avatar"><Shield size={16} /></span>
          <span className="tenant-copy"><strong>{storeData.length === 1 ? storeData[0].name : "החנויות שלי"}</strong><small>{storeData.length === 1 ? "חנות אחת מחוברת" : storeData.length ? `${storeData.length} חנויות מחוברות` : "חיבור חנות"}</small></span>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <nav className="nav-list">
          {[{ title: "ניטור וחקירות", items: nav.slice(0, 3) }, { title: "ניהול החנות", items: nav.slice(3) }].map((group) => <div className="nav-group" key={group.title}>
            <h2 className="nav-group-title">{group.title}</h2>
            {group.items.map(({ id, label, Icon, count }) => <SidebarItem key={id} label={label} Icon={Icon} active={view === id} collapsed={collapsed}
              count={count && (id !== "cases" || caseData.some((item) => !["resolved", "false-positive"].includes(item.status))) ? id === "cases" ? caseData.filter((item) => !["resolved", "false-positive"].includes(item.status)).length : count : undefined}
              onClick={() => { setView(id); setMobileNav(false); }} />)}
          </div>)}
        </nav>
        <div className="sidebar-footer">
          <SidebarItem label="ניהול הפלטפורמה" Icon={Gauge} active={view === "platform"} collapsed={collapsed} onClick={() => { setView("platform"); setMobileNav(false); }} />
          <SidebarItem label="הגדרות התראות" Icon={Settings} collapsed={collapsed} onClick={() => { setView("notifications"); setMobileNav(false); }} />
          <div className="user-block" title="חשבון בעלים"><div className="user-avatar"><CircleUserRound size={17} /></div><div className="user-copy"><strong>חשבון בעלים</strong></div></div>
          <button className="sidebar-collapse-control" onClick={toggleCollapsed} aria-label={collapsed ? "הרחבת סרגל הצד" : "קיפול סרגל הצד"} title={collapsed ? "הרחבת סרגל הצד" : "קיפול סרגל הצד"} aria-expanded={!collapsed} aria-controls="primary-navigation">{collapsed ? <PanelRightOpen size={20} aria-hidden="true" /> : <PanelRightClose size={20} aria-hidden="true" />}<span className="nav-label">קיפול סרגל הצד</span></button>
        </div>
      </aside>
      {mobileNav ? <button className="mobile-nav-backdrop" aria-label="סגירת תפריט" onClick={() => setMobileNav(false)} /> : null}

      <main className="main-content" id="main-content">
        <header className="topbar">
          <div className="workspace-location">
            <button id="mobile-navigation-trigger" className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="פתיחת תפריט" aria-expanded={mobileNav} aria-controls="primary-navigation"><Menu size={20} /></button>
            <span className="workspace-current">{nav.find((item) => item.id === view)?.label ?? "ניהול הפלטפורמה"}</span>
          </div>
          <div className={`topbar-context sync-${syncState === "expired" ? "error" : syncState} ${realtimeNeedsSetup && storeData.length ? "sync-warning" : ""}`}><span className="live-dot" />{syncState === "expired" ? <a href="/login?next=%2F">הכניסה פגה — להתחברות מחדש</a> : syncState === "error" ? "העדכון נכשל — מוצגים הנתונים האחרונים" : syncState === "loading" ? "מסנכרן…" : realtimeActive ? "ניטור בזמן אמת" : realtimeRegistered ? "ממתין להזמנה חדשה" : storeData.length ? "נדרש חיבור מחדש" : "אין חנות מחוברת"}</div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" onClick={() => setView("notifications")} aria-label="הגדרות התראות"><Bell size={19} /><span /></button>
          </div>
        </header>
        {decisionNotice && !selectedCase ? <div className="decision-toast" role="status"><CheckCircle2 size={18} /><span>{decisionNotice}</span><button className="icon-button" onClick={() => setDecisionNotice("")} aria-label="סגירת הודעה"><X size={17} /></button></div> : null}

        {view === "overview" || view === "cases" ? (
          <Overview
            key={`${view}-${decisionVersion}`}
            cases={visibleCases}
            ledger={giftLedger}
            query={query}
            setQuery={setQuery}
            severity={severity}
            setSeverity={setSeverity}
            store={store}
            setStore={setStore}
            stores={storeData}
            onOpen={openCase}
            casesOnly={view === "cases"}
            onRefresh={refreshSnapshot}
            refreshing={syncState === "loading"}
            deliveries={deliveries}
            onShowAll={() => setView("cases")}
            onOpenNotifications={() => setView("notifications")}
            onOpenStores={() => setConnectOpen(true)}
          />
        ) : null}
        {view === "stores" ? <StoresScreen stores={storeData} onConnect={() => setConnectOpen(true)} onSync={syncShopifyStore} syncing={syncState === "loading"} syncProgress={syncProgress} /> : null}
        {view === "gift-cards" ? <GiftCardWorkspace ledger={giftLedger} stores={storeData} cases={caseData} onOpenCase={openCase} onRefresh={refreshSnapshot} /> : null}
        {view === "employees" ? <EmployeesScreen employees={employeeData} activity={employeeDiscountActivity} settings={employeeSettings} stores={storeData} onSync={syncShopifyStore} syncing={syncState === "loading"} syncProgress={syncProgress} onCreate={createEmployee} onUpdate={updateEmployeeProfile} onSaveSettings={saveEmployeeMonitoring} /> : null}
        {view === "rules" ? <RulesScreen rules={ruleData} onToggle={toggleRule} onSave={saveRule} onCreate={createRule} /> : null}
        {view === "notifications" ? <NotificationsScreen settings={notifications} deliveries={deliveries} onSave={saveNotifications} /> : null}
        {view === "network" ? <NetworkScreen reports={reports} cases={caseData} onRelease={releaseBlock} /> : null}
        {view === "team" ? <TeamScreen /> : null}
        {view === "platform" ? <PlatformScreen /> : null}
      </main>

      {selectedCase ? <InvestigationDrawer item={selectedCase} storeDomain={storeData.find((store) => store.id === selectedCase.storeId)?.domain} notice={decisionNotice} relatedCount={relatedCaseCount(caseData, selectedCase)} onClose={() => setSelectedCase(null)} onDecide={decideCase} /> : null}
      {connectOpen ? <ConnectStoreDialog onClose={() => setConnectOpen(false)} onConnect={connectShopifyStore} /> : null}
    </div>
  );
}

function PageHeading({ title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action}</div>;
}

type CaseCluster = {
  id: string;
  cases: FraudCase[];
  emails: string[];
  ips: string[];
  phones: string[];
  customers: string[];
  totalAmount: number;
  giftCardOrders: number;
  giftCardLinks: number;
  severity: Severity;
};

const severityOrder: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const isRealEmail = (value: string) => value.includes("@") && !value.startsWith("לא זמין");

function relatedCaseCount(cases: FraudCase[], source: FraudCase): number {
  const email = source.email.trim().toLowerCase();
  const realEmail = isRealEmail(email) && !isPayPlusPlaceholder(source) && !/general-customer@payplus/i.test(email);
  const customerId = realEmail ? source.context?.customerId : undefined;
  return cases.filter((item) => item.storeId === source.storeId && item.tenantId === source.tenantId
    && ["new", "review", "action"].includes(item.status)
    && (item.id === source.id || (realEmail && item.email.trim().toLowerCase() === email)
      || (customerId && !isPayPlusPlaceholder(item) && customerId === item.context?.customerId))).length;
}

function clusterCases(items: FraudCase[]): CaseCluster[] {
  const parents = items.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parents[b] = a; };
  const identityOwner = new Map<string, number>();

  items.forEach((item, index) => {
    const identities = [
      isRealEmail(item.email) ? `email:${item.email.trim().toLowerCase()}` : "",
      item.context?.ip ? `ip:${item.context.ip}` : "",
      item.context?.phone ? `phone:${item.context.phone.replace(/\D/g, "")}` : "",
      item.context?.customerId && !isPayPlusPlaceholder(item) ? `customer:${item.context.customerId}` : "",
      ...(item.context?.giftCards?.issued.map((card) => `gift-card:${card.giftCardId}`) ?? []),
      ...(item.context?.giftCards?.redeemed.map((card) => `gift-card:${card.giftCardId}`) ?? []),
      ...(item.context?.giftCards?.redeemed
        .map((card) => card.purchaserEmail)
        .filter((email): email is string => typeof email === "string" && isRealEmail(email))
        .map((email) => `email:${email.trim().toLowerCase()}`) ?? []),
    ].filter(Boolean);
    identities.map((identity) => `${item.tenantId}:${item.storeId}:${identity}`).forEach((identity) => {
      const owner = identityOwner.get(identity);
      if (owner === undefined) identityOwner.set(identity, index); else union(index, owner);
    });
  });

  const groups = new Map<number, FraudCase[]>();
  items.forEach((item, index) => { const root = find(index); (groups.get(root) ?? groups.set(root, []).get(root)!).push(item); });
  return [...groups.values()].map((cases) => {
    const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
    const emails = unique(cases.map((item) => isRealEmail(item.email) ? item.email.trim().toLowerCase() : undefined));
    const ips = unique(cases.map((item) => item.context?.ip));
    const phones = unique(cases.map((item) => item.context?.phone));
    const customers = unique(cases.map((item) => !isPayPlusPlaceholder(item) ? item.context?.customerId : undefined));
    const severity = cases.reduce<Severity>((highest, item) => severityOrder[item.severity] > severityOrder[highest] ? item.severity : highest, "low");
    return {
      id: cases.map((item) => item.id).sort()[0], cases, emails, ips, phones, customers, severity,
      totalAmount: cases.reduce((sum, item) => sum + item.amount, 0),
      giftCardOrders: cases.filter((item) => item.items.some((line) => /gift\s*card|גיפט\s*קארד|כרטיס\s*מתנה/i.test(line.name))).length,
      giftCardLinks: cases.reduce((sum, item) => sum + (item.context?.giftCards?.redeemed.filter((redemption) => redemption.identityChanged).length ?? 0), 0),
    };
  }).sort((left, right) => severityOrder[right.severity] - severityOrder[left.severity] || right.cases.length - left.cases.length);
}

function Overview({ cases, ledger, query, setQuery, severity, setSeverity, store, setStore, stores, onOpen, casesOnly, onRefresh, refreshing, deliveries, onShowAll, onOpenNotifications, onOpenStores }: {
  ledger?: GiftLedger;
  cases: FraudCase[]; query: string; setQuery: (value: string) => void; severity: Severity | "all"; setSeverity: (value: Severity | "all") => void;
  store: string; setStore: (value: string) => void; stores: Store[]; onOpen: (item: FraudCase) => void; casesOnly: boolean;
  onRefresh: () => Promise<void>; refreshing: boolean;
  deliveries: NotificationDelivery[];
  onShowAll: () => void; onOpenNotifications: () => void; onOpenStores: () => void;
}) {
  const hasStores = stores.length > 0;
  const automaticallyClosed = cases.filter(isAutomaticallyResolved).length;
  const merchantDecisions = cases.filter((item) => ["fraud", "false-positive"].includes(item.status) || (item.status === "resolved" && !isAutomaticallyResolved(item))).length;
  const [showClosed, setShowClosed] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const activeCases = cases.filter((item) => ["new", "review", "action"].includes(item.status));
  const displayCases = casesOnly && showClosed ? cases : activeCases;
  const clusters = useMemo(() => clusterCases(displayCases), [displayCases]);
  const selectedCluster = clusters.find((cluster) => cluster.id === selectedClusterId);
  return <div className={`page-content product-page ${casesOnly ? "evidence-workspace" : "overview-workspace"}`}>
    <PageHeading eyebrow="" title={casesOnly ? "התראות וחקירות" : hasStores ? "תמונת מצב" : "חיבור חנות Shopify"} description={hasStores ? undefined : "חבר חנות כדי להתחיל לנטר הזמנות."} action={hasStores ? <button className="secondary-button" onClick={() => void onRefresh()} disabled={refreshing}><RefreshCcw size={15} className={refreshing ? "spin" : ""} /> {refreshing ? "מסנכרן…" : "רענון נתונים"}</button> : <button className="primary-button" onClick={onOpenStores}><Plus size={16} /> חיבור חנות</button>} />

    {!casesOnly && !hasStores ? <section className="connection-empty"><div className="connection-empty-icon"><StoreIcon size={28} /></div><div><span className="eyebrow">מתחילים מנתונים אמיתיים</span><h2>סביבת העבודה נקייה ומוכנה לחיבור</h2><p>לא יופיעו עסקאות, עובדים, התראות או נתוני לקוחות עד שחנות Shopify אמיתית תחובר.</p></div><ol><li><strong>1</strong><span>מחברים חנות ומאשרים גישה להזמנות</span></li><li><strong>2</strong><span>בוחרים חוקי סיכון ונמעני אימייל</span></li><li><strong>3</strong><span>הזמנות חדשות נבדקות בזמן אמת</span></li></ol><button className="primary-button" onClick={onOpenStores}>עבור לחיבור חנות <ChevronLeft size={15} /></button></section> : null}

    {!casesOnly && hasStores ? <>
      <section className="overview-brief" aria-label="תמונת מצב">
        <div className="attention-summary">
          <div className="brief-label"><h2>התראות פתוחות</h2><ShieldAlert size={20} aria-hidden="true" /></div>
          <strong className="attention-total">{activeCases.length}</strong>
          <div className="attention-context"><span className="urgent-count"><ShieldAlert size={14} aria-hidden="true" />קריטיות: {activeCases.filter((item) => item.severity === "critical").length}</span></div>
          <button className="text-button" onClick={onShowAll}>לבדיקת ההתראות <ChevronLeft size={17} /></button>
        </div>
        <div className="exposure-summary">
          <div className="brief-label"><h2>סכום הזמנות פתוחות</h2><CreditCard size={20} aria-hidden="true" /></div>
          <strong className="exposure-total"><bdi>{formatCurrency(activeCases.reduce((sum, item) => sum + item.amount, 0))}</bdi></strong>
          <p>סכום ההזמנות בהתראות פתוחות, לא נזק מאומת.</p>
        </div>
        <div className="activity-summary">
          <div className="activity-stat"><CheckCircle2 size={18} aria-hidden="true" /><div><span>נסגרו לפי החוקים</span><strong>{automaticallyClosed}</strong><small>{merchantDecisions} בהחלטת בעל החנות</small></div></div>
          <div className="activity-stat"><Mail size={18} aria-hidden="true" /><div><span>התראות אימייל שנשלחו</span><strong>{deliveries.filter((item) => ["sent", "simulated"].includes(item.status)).length}</strong><button className="text-button" onClick={onOpenNotifications}>הגדרות <ChevronLeft size={14} /></button></div></div>
        </div>
      </section>
      <section className="overview-notes" aria-label="ניטור והתראות">
        <button onClick={onOpenNotifications}><Mail size={18} aria-hidden="true" /><span><strong>נמעני התראות</strong></span><ChevronLeft size={16} aria-hidden="true" /></button>
        <button onClick={onShowAll}><UsersRound size={18} aria-hidden="true" /><span><strong>רכישות עובדים</strong><small>{cases.some((item) => item.evidence.some((evidence) => evidence.source === "employee")) ? "נמצאו התאמות" : "ללא התאמות"}</small></span><ChevronLeft size={16} aria-hidden="true" /></button>
      </section>
    </> : null}

    {casesOnly && hasStores ? <section className="triage-summary" aria-label="סיכום תור ההתראות">
      <div><span>פתוחות</span><strong>{activeCases.length}</strong></div>
      <div><span>קריטיות</span><strong>{activeCases.filter((item) => item.severity === "critical").length}</strong></div>
      <div><span>גבוהות</span><strong>{activeCases.filter((item) => item.severity === "high").length}</strong></div>
      <p>מקובצות לפי פרטי זיהוי משותפים</p>
    </section> : null}

    <section className="case-section">
      <div className="section-heading"><div><h2>{casesOnly ? "התראות לפי זהות" : "תור החלטות"}</h2><span>{clusters.length} קבוצות · {displayCases.length} הזמנות</span></div>{casesOnly ? <button className="secondary-button" onClick={() => setShowClosed((value) => !value)}>{showClosed ? "הצג פעילות בלבד" : `הצג גם סגורות (${cases.length - activeCases.length})`}</button> : <button className="text-button" onClick={onShowAll}>הצג הכל <ChevronLeft size={14} /></button>}</div>
      <div className="filter-bar">
        <label className="search-box"><Search size={16} /><span className="sr-only">חיפוש</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש הזמנה, לקוח או סיבה" /></label>
        <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity | "all")} aria-label="סינון לפי חומרה"><option value="all">כל החומרות</option><option value="critical">קריטי</option><option value="high">גבוה</option><option value="medium">בינוני</option><option value="low">נמוך</option></select>
        <select value={store} onChange={(event) => setStore(event.target.value)} aria-label="סינון לפי חנות"><option value="all">כל החנויות</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
      <div className="case-cluster-list">
        {displayCases.length > 0 ? <div className="case-queue-head" aria-hidden="true"><span>חומרה</span><span>זהות וסיבת ההתראה</span><span>הזמנות</span><span>סכום</span><span>מצב</span></div> : null}
        {clusters.map((cluster) => {
          const giftSummary = summarizeGiftCluster(cluster.cases, ledger);
          const isGiftJourney = giftSummary.purchases.length > 0 && giftSummary.redemptions.length > 0;
          const activeClusterCases = cluster.cases.filter((item) => ["new", "review", "action"].includes(item.status));
          const closedByRules = activeClusterCases.length === 0 && cluster.cases.every(isAutomaticallyResolved);
          const activeSeverity = activeClusterCases.reduce<Severity>((highest, item) => severityOrder[item.severity] > severityOrder[highest] ? item.severity : highest, "low");
          const statusCase = activeClusterCases.find((item) => item.status === "action") ?? activeClusterCases.find((item) => item.status === "review") ?? activeClusterCases[0] ?? cluster.cases[0];
          const repeatedBy = cluster.cases.length > 1
            ? cluster.giftCardLinks > 0 ? "רכישה ומימוש מקושרים דרך Gift Card"
              : cluster.emails.length === 1 ? `אותו אימייל · ${cluster.emails[0]}`
              : cluster.ips.length === 1 ? `אותה כתובת IP · ${cluster.ips[0]}`
                : cluster.phones.length === 1 ? `אותו טלפון · ${cluster.phones[0]}`
                  : "זהויות מקושרות"
            : customerDisplayName(cluster.cases[0]);
          return <article className={`case-cluster ${cluster.cases.length > 1 ? "case-cluster-linked" : ""}`} key={cluster.id}>
            <button className="case-cluster-summary" onClick={() => cluster.cases.length === 1 ? onOpen(cluster.cases[0]) : setSelectedClusterId(cluster.id)} aria-haspopup="dialog">
              <div className="cluster-severity">{closedByRules ? <span className="closed-by-rules"><CheckCircle2 size={15} /> נסגר לפי החוקים</span> : <SeverityBadge severity={activeClusterCases.length ? activeSeverity : cluster.severity} score={Math.max(...(activeClusterCases.length ? activeClusterCases : cluster.cases).map((item) => item.score))} />}</div>
              <div className="cluster-identity"><strong>{repeatedBy}</strong><span>{cluster.cases.length > 1 ? cluster.giftCardLinks > 0 ? `${cluster.cases.length} הזמנות מקושרות ברכישה ובמימוש` : `${cluster.cases.length} הזמנות עם פרטי זיהוי משותפים` : `${cluster.cases[0].orderNumber} · ${cluster.cases[0].reason}`}</span><div className="cluster-signals">{cluster.emails.length > 1 ? <span><Mail size={13} /> {cluster.emails.length} אימיילים</span> : null}{cluster.ips.length === 1 && cluster.cases.length > 1 ? <span><Wifi size={13} /> IP משותף</span> : null}{cluster.phones.length === 1 && cluster.cases.length > 1 ? <span><Phone size={13} /> טלפון משותף</span> : null}{cluster.giftCardOrders > 0 ? <span><Gift size={13} /> {cluster.giftCardOrders} Gift Card</span> : null}{cluster.giftCardLinks > 0 ? <span className="gift-card-link-signal"><Fingerprint size={13} /> {cluster.giftCardLinks} מימושים מקושרים</span> : null}</div></div>
              <div className="cluster-stat"><span>הזמנות</span><strong>{cluster.cases.length}</strong></div>
              {isGiftJourney ? <div className="cluster-stat cluster-gift-amounts"><span>נרכש בגיפטקארדים</span><strong>{giftSummary.missingPurchaseAmounts ? "נדרשת השלמת סכום" : moneyTotals(giftSummary.purchased)}</strong><span>מומש מתוכם <bdi>{moneyTotals(giftSummary.linkedRedeemed)}</bdi></span></div> : <div className="cluster-stat"><span>סכום הזמנות</span><strong>{formatCurrency(cluster.totalAmount)}</strong></div>}
              <div className="cluster-status"><span className={`status status-${statusCase.status}`}>{closedByRules ? "נסגר אוטומטית" : caseStatusLabel(statusCase)}</span><ChevronLeft size={18} /></div>
            </button>
          </article>;
        })}
        {displayCases.length === 0 ? <div className="empty-state"><Shield size={26} /><strong>{hasStores ? "אין כרגע התראות פעילות" : "אין נתונים להצגה"}</strong><span>{hasStores ? "שינויי החוקים חושבו מחדש. הזמנות חשודות חדשות יופיעו כאן." : "חבר חנות Shopify כדי להתחיל לקבל ולבדוק הזמנות."}</span></div> : null}
      </div>
    </section>
    {selectedCluster ? <ClusterInvestigation cluster={selectedCluster} ledger={ledger} onClose={() => setSelectedClusterId(null)} onOpen={(item) => { setSelectedClusterId(null); onOpen(item); }} /> : null}
  </div>;
}

const moneyTotals = (amounts: MoneyTotal[]) => amounts.length ? amounts.map(({ amount, currency }) => new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount)).join(" · ") : "לא נמצא בנתונים";

function ClusterInvestigation({ cluster, ledger, onClose, onOpen }: { cluster: CaseCluster; ledger?: GiftLedger; onClose: () => void; onOpen: (item: FraudCase) => void }) {
  const summary = summarizeGiftCluster(cluster.cases, ledger);
  const gift = summary.purchases.length > 0 || summary.redemptions.length > 0;
  const [section, setSection] = useState<"redemptions" | "purchases" | "other">(summary.redemptions.length ? "redemptions" : summary.purchases.length ? "purchases" : "other");
  const titles = { redemptions: "מימושי גיפטקארד", purchases: "רכישות גיפטקארד", other: "הזמנות נוספות" };
  const rows = gift ? summary[section] : cluster.cases;
  return <CenteredDialog label="חקירת קבוצת הזמנות" onClose={onClose} className="cluster-investigation">
    <header className="drawer-header"><div><span className="case-kicker">חקירה מקושרת · {cluster.cases.length} הזמנות</span><h2>{gift ? "מסלול הכסף, מהרכישה למימוש" : "הזמנות עם פרטי זיהוי משותפים"}</h2><p>{cluster.cases[0].storeName} · {cluster.emails.length} כתובות אימייל · קישור אינו הוכחה להונאה</p></div><button autoFocus className="icon-button" onClick={onClose} aria-label="סגירת הקבוצה"><X size={20} /></button></header>
    <div className="cluster-dialog-body">
      {gift ? <><div className="gift-money-flow"><div><span>נרכש בגיפטקארדים</span><strong><bdi>{summary.missingPurchaseAmounts ? "נדרשת השלמת סכום" : moneyTotals(summary.purchased)}</bdi></strong><small>{summary.purchases.length} הזמנות רכישה בקבוצה</small></div><ChevronLeft aria-hidden="true" size={22} /><div><span>מומש מתוך הכרטיסים האלו</span><strong><bdi>{moneyTotals(summary.linkedRedeemed)}</bdi></strong><small>לפי מזהי כרטיסים תואמים בלבד</small></div></div><p className="gift-money-note">רכישה ומימוש הם שני שלבים של אותו כסף ולכן אינם מחוברים לסכום כולל. סכום הרכישה לאחר הנחות ולפני החזרים ומסים; אינו יתרת כרטיסים.</p>
      {summary.missingPurchaseAmounts ? <p role="status" className="gift-ledger-message">חסר פירוט סכום ב־{summary.missingPurchaseAmounts} הזמנות רכישה. סריקת Shopify במעקב גיפטקארדים תשלים את הנתונים.</p> : null}
      {summary.refunded.length ? <p className="gift-money-note">החזרים מוצלחים לגיפטקארדים בהזמנות הקבוצה: <bdi>{moneyTotals(summary.refunded)}</bdi></p> : null}
      <div className="gift-ledger-tabs" role="group" aria-label="סוג הזמנות בקבוצה">{(["redemptions", "purchases", "other"] as const).map((key) => <button key={key} aria-pressed={section === key} onClick={() => setSection(key)}>{titles[key]} <span>{summary[key].length}</span></button>)}</div></> : <p className="gift-money-note">פתח הזמנה להצגת הראיות וקבלת החלטה. סטטוס כל הזמנה נשמר בנפרד.</p>}
      <div className="cluster-dialog-orders">{rows.map((item) => <button key={item.id} className="cluster-dialog-order" onClick={() => onOpen(item)} aria-haspopup="dialog"><span className="order-number"><bdi>#{item.orderNumber.replace(/^#/, "")}</bdi><small>{item.createdAt}</small></span><span className="order-buyer"><strong>{customerDisplayName(item)}</strong><small><bdi>{isRealEmail(item.email) ? item.email : "פרטי קשר לא התקבלו"}</bdi></small><small>{item.reason}</small></span><span className="order-value"><strong><bdi>{formatCurrency(item.amount)}</bdi></strong><small>סכום ההזמנה</small></span><span className={`status status-${item.status}`}>{caseStatusLabel(item)}</span><ChevronLeft size={17} /></button>)}{!rows.length ? <p className="gift-ledger-empty">אין הזמנות מסוג זה בקבוצה.</p> : null}</div>
    </div><footer className="cluster-dialog-footer">פתיחת הזמנה תציג חלון חקירה במרכז. סגירתו תחזיר אותך לקבוצה הזאת.</footer>
  </CenteredDialog>;
}

function Metric({ icon, label, value, detail, tone = "default" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

const giftCardDisplayId = (giftCardId: string) => `GC-${giftCardId.split("/").at(-1)?.slice(-8) ?? "לא ידוע"}`;

function GiftCardTrail({ item }: { item: FraudCase }) {
  const activity = item.context?.giftCards;
  if (!activity || (!activity.issued.length && !activity.redeemed.length)) return null;
  const issuedRedemptions = activity.issued.flatMap((card) => card.redemptions.map((redemption) => ({ card, redemption })));
  const currentRedemptions = activity.redeemed.map((redemption) => ({
    card: activity.issued.find((candidate) => candidate.giftCardId === redemption.giftCardId),
    redemption,
  }));
  const links = currentRedemptions.length ? currentRedemptions : issuedRedemptions;
  const redeemedCount = activity.issued.filter((card) => card.redemptions.length > 0).length;
  return <section className="gift-card-trail" aria-label="מסלול כרטיסי המתנה">
    <div className="gift-card-trail-heading"><div><Gift size={17} /><div><strong>מסלול Gift Card</strong><span>{activity.issued.length ? `${activity.issued.length} כרטיסים הונפקו · ${redeemedCount} כבר מומשו` : `${activity.redeemed.length} כרטיסים מומשו בהזמנה זו`}</span></div></div><span className="gift-card-safe">הקוד המלא אינו נשמר</span></div>
    {links.length ? <div className="gift-card-links">{links.slice(0, 8).map(({ card, redemption }) => <article key={redemption.transactionId ?? `${redemption.giftCardId}:${redemption.orderId}`}>
      <div className="gift-card-id"><span>{redemption.maskedCode}</span><strong className="mono">{giftCardDisplayId(redemption.giftCardId)}</strong></div>
      <div className="gift-card-route"><div><span>נרכש</span><strong>{redemption.purchaseOrderNumber ?? card?.purchaseOrderNumber ?? "הזמנה לא ידועה"}</strong><small>{redemption.purchaserCustomer || redemption.purchaserEmail || "זהות הרוכש לא התקבלה"}</small></div><ChevronLeft size={17} /><div><span>מומש</span><strong>{redemption.orderNumber}</strong><small>{redemption.customer || redemption.email}</small></div></div>
      <div className="gift-card-link-result"><strong>{new Intl.NumberFormat("he-IL", { style: "currency", currency: redemption.currency ?? "ILS" }).format(redemption.amount)}</strong><span className={redemption.identityChanged ? "identity-changed" : "identity-same"}>{redemption.identityChanged ? "פרטי קונה ומממש שונים" : "לא זוהה שינוי בפרטים"}</span><small>{redemption.confidence === "exact-id" ? "התאמה לפי מזהה Shopify" : "התאמה חלקית — אינה הוכחה"}</small></div>
    </article>)}</div> : <div className="gift-card-unredeemed"><strong>{activity.issued.length} כרטיסים ללא מימוש שאותר</strong><span>לא נמצא מימוש בנתונים שנבדקו. זו אינה בדיקת יתרה; אפשר להרחיב את הסריקה במעקב גיפטקארדים.</span></div>}
    <p className="gift-card-more"><a href={`/?view=gift-cards&order=${encodeURIComponent(item.orderNumber)}`}>{links.length > 8 ? `ועוד ${links.length - 8} מימושים מקושרים · ` : ""}למסלול המלא במעקב גיפטקארדים</a></p>
  </section>;
}

function InvestigationDrawer({ item, storeDomain, notice, relatedCount, onClose, onDecide }: { item: FraudCase; storeDomain?: string; notice: string; relatedCount: number; onClose: () => void; onDecide: (status: CaseStatus, includeRelated?: boolean) => void }) {
  const [confirmingFraud, setConfirmingFraud] = useState(false);
  const closedByRules = isAutomaticallyResolved(item);
  const numericOrderId = item.context?.shopifyOrderId?.match(/\d+$/)?.[0];
  const shopifyUrl = storeDomain && numericOrderId ? `https://${storeDomain}/admin/orders/${numericOrderId}` : null;
  const missingBuyerIdentity = isPayPlusPlaceholder(item) || ["ללא שם", "לקוח Shopify", ""].includes(item.customer.trim());
  const formatEvidenceTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  };
  return <CenteredDialog label={`חקירת הזמנה ${item.orderNumber}`} onClose={onClose} className="order-investigation">
      <header className="drawer-header"><div><span className="case-kicker">תיק חקירה</span><div className="drawer-title"><h2>{item.orderNumber}</h2>{closedByRules ? <span className="closed-by-rules"><CheckCircle2 size={15} /> נסגר לפי החוקים</span> : <SeverityBadge severity={item.severity} score={item.score} />}</div><p>{item.storeName} · נפתח {item.createdAt}</p></div><button autoFocus className="icon-button" onClick={onClose} aria-label="סגירת תיק"><X size={20} /></button></header>
      <div className="drawer-body">
        <section className={`case-summary-strip ${closedByRules ? "case-summary-resolved" : ""}`}><div><span>{closedByRules ? "מצב התראה" : "סיבת ההתראה"}</span><h3>{closedByRules ? "ההתראה אינה פעילה" : item.reason}</h3><p>{closedByRules ? item.resolution?.note ?? "ההזמנה אינה עומדת כרגע באף חוק סיכון פעיל. לא התקבלה החלטה אנושית לגביה." : "המערכת מציגה את העובדות שנמצאו. ההחלטה נשארת בידי בעל החנות."}</p></div><dl><div><dt>ציון</dt><dd>{item.score}</dd></div><div><dt>תנאים</dt><dd>{item.evidence.length}</dd></div><div><dt>סכום</dt><dd>{formatCurrency(item.amount)}</dd></div></dl></section>
        <div className="drawer-grid">
          <details className="evidence-section"><summary>ספר הראיות <span>{item.evidence.length} תנאים</span><ChevronDown size={16} /></summary><div className="evidence-ledger">{item.evidence.map((evidence) => <article key={evidence.id} className="evidence-node"><span className={`evidence-source source-${evidence.source}`}>{sourceLabels[evidence.source]}</span><div className="evidence-finding"><h4>{evidence.label}</h4><p>{evidence.description}</p></div><time className="evidence-time mono">{formatEvidenceTime(evidence.timestamp)}</time></article>)}</div></details>
          <details className="order-context" open><summary>פרטי ההזמנה והקשר ללקוח <ChevronDown size={17} /></summary><div className="order-context-details"><h3>זהות והקשר להזמנה</h3><p className="context-note">הפרטים עוזרים לחבר בין עסקאות. כתובת IP לבדה אינה מזהה אדם בוודאות.</p>{missingBuyerIdentity ? <div className="identity-data-notice"><Info size={18} /><div><strong>{isPayPlusPlaceholder(item) ? "PayPlus העבירה ל-Shopify לקוח טכני, לא את זהות הקונה" : "Shopify לא החזירה שם לקוח להזמנה"}</strong><span>{item.context?.phone ? "קיים מספר טלפון ולכן אפשר לזהות ולקשר לפי הטלפון." : "לא התקבלו מספיק פרטי קשר כדי לזהות את האדם או לקשר אותו להזמנות אחרות."}</span></div></div> : null}<div className="identity-grid"><div><span><Wifi size={15} /> כתובת IP</span><strong className="mono">{item.context?.ip || "לא התקבלה מ־Shopify"}</strong></div><div><span><CreditCard size={15} /> אמצעי תשלום</span><strong>{item.context?.paymentGateways.join(", ") || "לא התקבל"}</strong></div><div><span><MapPin size={15} /> כתובת משלוח</span><strong>{item.context?.address || "לא התקבלה מ־Shopify"}</strong></div><div><span><Phone size={15} /> טלפון</span><strong className="mono">{item.context?.phone || "לא התקבל מ־Shopify"}</strong></div></div>{item.context?.ip ? <p className="context-note">ב־2 השעות האחרונות זוהו מה־IP הזה <strong>{item.context.ipOrderCountLastTwoHours ?? 1} הזמנות</strong>, מתוכן <strong>{item.context.ipGiftCardOrderCountLastTwoHours ?? 0} רכישות Gift Card</strong>, באמצעות <strong>{item.context.ipDistinctEmailsLastTwoHours ?? 1} אימיילים שונים</strong>.</p> : null}{item.context?.riskFacts.length ? <div className="shopify-risk-facts"><strong>אותות סיכון מ־Shopify</strong><ul>{item.context.riskFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div> : null}<GiftCardTrail item={item} /><h3>פרטי ההזמנה</h3><dl><div><dt>לקוח</dt><dd>{customerDisplayName(item)}</dd></div><div><dt>אימייל</dt><dd className="mono">{isRealEmail(item.email) ? item.email : "לא התקבל מ־Shopify"}</dd></div><div><dt>סכום</dt><dd className="mono">{formatCurrency(item.amount)}</dd></div><div><dt>חנות</dt><dd>{item.storeName}</dd></div></dl><h4>פריטים</h4><ul>{item.items.map((product) => <li key={product.name}><span>{product.quantity}× {product.name}</span><strong className="mono">{formatCurrency(product.quantity * product.price)}</strong></li>)}</ul>{shopifyUrl ? <a className="secondary-button full-button" href={shopifyUrl} target="_blank" rel="noopener noreferrer">פתח ב-Shopify <ExternalLink size={14} /></a> : <span className="context-note">קישור Shopify אינו זמין: מזהה ההזמנה או דומיין החנות חסרים.</span>}</div></details>
        </div>
      </div>
      {notice ? <p className="case-decision-notice" role="status">{notice}</p> : null}
      <footer className="decision-bar"><div><span>סטטוס נוכחי</span><strong>{closedByRules ? "נסגר לפי החוקים" : caseStatusLabel(item)}</strong></div>{closedByRules ? <span className="decision-explanation">שינוי בחוקים שיחזיר התאמה יפתח את ההתראה מחדש אוטומטית.</span> : confirmingFraud ? <div className="fraud-confirm"><strong>לאשר הונאה?</strong><span>רק הזמנות של אותו אימייל או מזהה לקוח באותה חנות. מימושים של לקוח אחר ו־IP משותף לא נכללים.</span><div><button className="secondary-button" onClick={() => setConfirmingFraud(false)}>ביטול</button><button className="danger-button" onClick={() => onDecide("fraud")}>רק הזמנה זו</button>{relatedCount > 1 ? <button className="danger-button" onClick={() => onDecide("fraud", true)}>כל {relatedCount} ההזמנות של אותו לקוח</button> : null}</div></div> : <div className="decision-actions">{item.status === "new" ? <button className="secondary-button" onClick={() => onDecide("review")}>העבר לבדיקה</button> : null}<button className="secondary-button" onClick={() => onDecide("false-positive")}>לא חשוד</button><button className="secondary-button" onClick={() => onDecide("resolved")}><CheckCircle2 size={16} /> סגור כטופל</button>{item.status !== "fraud" ? <button className="danger-button" onClick={() => setConfirmingFraud(true)}><ShieldAlert size={16} /> אשר הונאה והוסף לחסימה</button> : null}</div>}</footer>
  </CenteredDialog>;
}

function ConnectStoreDialog({ onClose, onConnect }: { onClose: () => void; onConnect: (input: { shopDomain: string; clientId: string; clientSecret: string }) => Promise<void> }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setConnecting(true); setError("");
    try {
      await onConnect({
        shopDomain: String(form.get("shopDomain") ?? ""),
        clientId: String(form.get("clientId") ?? ""),
        clientSecret: String(form.get("clientSecret") ?? ""),
      });
      onClose();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "SHOPIFY_CONNECTION_FAILED";
      const messages: Record<string, string> = {
        INVALID_SHOP_DOMAIN: "כתובת החנות חייבת להסתיים ב־myshopify.com.",
        SHOP_NOT_FOUND: "Shopify לא מצאה חנות בכתובת הזאת. העתק את דומיין ה־myshopify.com המדויק מתוך הגדרות החנות.",
        SHOP_NOT_PERMITTED: "Shopify חסמה את החיבור: החנות והאפליקציה אינן באותו Shopify Organization. לחנות הזאת נדרש חיבור OAuth.",
        INVALID_CLIENT_CREDENTIALS: "ה־Client ID או ה־Client secret אינם נכונים. העתק אותם מחדש מעמוד Settings של אותה אפליקציה.",
        APP_NOT_INSTALLED: "האפליקציה עדיין לא מותקנת על החנות. התקן אותה מתוך Dev Dashboard ונסה שוב.",
        CREDENTIALS_OR_INSTALLATION_INVALID: "Shopify דחתה את פרטי החיבור. ודא שהאפליקציה שוחררה, הותקנה על החנות ושהפרטים הועתקו מ־Settings.",
        MANUAL_CONNECTIONS_DISABLED: "חיבור ידני אינו מופעל בשרת הזה.",
      };
      setError(messages[code] ?? `החיבור נכשל (${code}). לא נשמרו פרטי גישה.`);
    } finally { setConnecting(false); }
  };
  return <CenteredDialog className="connect-dialog" label="חיבור חנות Shopify" onClose={() => { if (!connecting) onClose(); }}>
      <header><div className="connect-brand"><div><StoreIcon size={21} /></div><span>Shopify</span></div><button className="icon-button" onClick={onClose} disabled={connecting} aria-label="סגירת חלון החיבור"><X size={19} /></button></header>
      <div className="connect-copy"><span className="eyebrow">חיבור ישיר ומאובטח</span><h2>חיבור חנות Shopify</h2><p>מתאים לבדיקת חנות ששייכת לארגון Shopify שלך. המערכת מחליפה את פרטי האפליקציה ב־Access Token ובודקת את זהות החנות.</p></div>
      <form onSubmit={submit} className="connect-form" autoComplete="off">
        <label className="field-label">כתובת החנות<span>הדומיין הקבוע של החנות, לא כתובת האתר הציבורית.</span><div className="domain-input"><span aria-hidden="true">https://</span><input name="shopDomain" dir="ltr" required placeholder="your-store.myshopify.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" aria-label="דומיין קבוע של חנות Shopify" /></div></label>
        <div className="credentials-grid"><label className="field-label">Client ID<input name="clientId" dir="ltr" required autoComplete="off" placeholder="מ־Shopify Dev Dashboard" /></label><label className="field-label">Client secret<input name="clientSecret" dir="ltr" type="password" required autoComplete="new-password" placeholder="••••••••••••••••" /></label></div>
        <div className="credential-note"><LockKeyhole size={17} /><div><strong>ה־Client secret לא נשמר בדפדפן</strong><span>הוא נשלח לשרת כדי להתחבר ל־Shopify. מעקב הגיפטקארדים משתמש בנתוני הזמנות ובאירועים הזמינים בהרשאות החיבור. קריאת יתרות כרטיסים היא יכולת נפרדת שדורשת read_gift_cards.</span></div></div>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="connect-help"><span>את הפרטים מוצאים ב־Dev Dashboard ← Apps ← האפליקציה שלך ← Settings.</span><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">פתח Dev Dashboard <ExternalLink size={13} /></a></div>
        <footer><button type="button" className="secondary-button" onClick={onClose} disabled={connecting}>ביטול</button><button className="primary-button" disabled={connecting}>{connecting ? <><RefreshCcw size={15} className="spin" /> בודק מול Shopify…</> : <><Shield size={15} /> בדוק וחבר חנות</>}</button></footer>
      </form>
  </CenteredDialog>;
}

function StoresScreen({ stores, onConnect, onSync, syncing, syncProgress }: { stores: Store[]; onConnect: () => void; onSync: (storeId: string) => Promise<void>; syncing: boolean; syncProgress: string | null }) {
  const connected = stores.filter((store) => ["active", "registered"].includes(store.realtimeStatus ?? "")).length;
  const ordersToday = stores.reduce((total, store) => total + store.ordersLast30Days, 0);
  return <div className="page-content product-page stores-page"><PageHeading eyebrow="חיבורי SHOPIFY" title="החנויות שמוגנות כרגע" description="לכל חנות סביבת עבודה נפרדת. כאן אפשר לראות אם הנתונים נקלטים ומתי התקבלה ההזמנה האחרונה." action={<button className="primary-button" onClick={onConnect}><Plus size={16} /> חיבור חנות</button>} />
    <section className="compact-overview"><div><span>חנויות מחוברות</span><strong>{connected} מתוך {stores.length}</strong><small>מקבלות הזמנות בזמן אמת</small></div><div><span>הזמנות ב־30 יום</span><strong>{ordersToday.toLocaleString("he-IL")}</strong><small>מכל החנויות בארגון</small></div><div><span>דורש טיפול</span><strong>{stores.length - connected}</strong><small>חיבורים שצריך לבדוק</small></div></section>
    {syncProgress ? <p role="status" className="sync-progress-note">{syncProgress}</p> : null}
    {stores.length ? <div className="store-grid">{stores.map((item) => { const receiving = item.realtimeStatus === "active"; const registered = item.realtimeStatus === "registered"; const realtimeReady = receiving || registered; const configuring = item.realtimeStatus === "configuring"; const giftCardActive = item.giftCardTrackingStatus === "active"; const giftCardApproval = item.giftCardTrackingStatus === "shopify-approval-required" || item.giftCardTrackingStatus === "permission-required"; return <article className="store-card" key={item.id}><div className="store-card-top"><div className="store-logo"><StoreIcon /></div><span className={`connection-state ${realtimeReady ? "state-active" : "state-degraded"}`}>{receiving ? "אירועים נקלטים בזמן אמת" : registered ? "קליטה חיה הוגדרה · ממתין להזמנה" : configuring ? "מגדיר קליטה בזמן אמת" : "נדרש חיבור מחדש לזמן אמת"}</span></div><h2>{item.name}</h2><p className="mono">{item.domain}</p>{item.giftCardTrackingStatus ? <div className={`gift-card-tracking-state ${giftCardActive ? "tracking-active" : "tracking-permission"}`}><Gift size={16} /><div><strong>{giftCardActive ? `גישה למאגר כרטיסים · ${item.giftCardsTracked ?? 0} כרטיסים` : giftCardApproval ? "מעקב לפי הזמנות · ללא גישה ליתרות" : "מעקב לפי ראיות הזמנה"}</strong><span>{giftCardActive ? "מסלולי הרכישה והמימוש נמצאים במסך מעקב גיפטקארדים." : giftCardApproval ? "ניתן לקשר רכישה למימוש כשמזהה הכרטיס מופיע באירועי ההזמנה ובעסקאות. read_gift_cards נדרשת לגישה ליתרות ולמאגר הכרטיסים, לא למסלול הראיות הזה." : "פתח את מעקב הגיפטקארדים וסרוק את ההזמנות הזמינות."}</span></div></div> : null}{!realtimeReady ? <div className="realtime-notice"><Info size={16} /><div><strong>סנכרון 30 הימים הושלם, אך קליטה חיה עדיין לא הוגדרה</strong><span>יש לבצע חיבור מחדש פעם אחת כדי לרשום את ההתראה האוטומטית מול Shopify.</span></div></div> : null}<div className="store-stats"><div><span>הזמנות ב־30 יום</span><strong>{item.ordersLast30Days.toLocaleString("he-IL")}</strong></div><div><span>הזמנה אחרונה שנשמרה</span><strong>{item.lastEventAt}</strong></div><div><span>אירוע חי אחרון</span><strong>{item.lastWebhookAt ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.lastWebhookAt)) : registered ? "ממתין להזמנה חדשה" : "עדיין לא התקבל"}</strong></div><div><span>סנכרון היסטורי אחרון</span><strong>{item.lastSyncAt ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.lastSyncAt)) : "לא בוצע"}</strong></div></div><div className="store-actions"><button onClick={() => void onSync(item.id)} disabled={syncing}>{syncing ? "מסנכרן…" : "סנכרן 30 יום מחדש"}</button><button className={!realtimeReady ? "reconnect-attention" : ""} onClick={onConnect} aria-label={`חיבור מחדש של ${item.name}`}><RefreshCcw size={15} /> חיבור מחדש</button></div></article>; })}</div> : <div className="empty-panel"><div className="empty-panel-icon"><StoreIcon size={25} /></div><h2>עדיין לא חוברה חנות</h2><p>לא הוזנו פרטי חנות לדוגמה. החנות הראשונה שתחבר תופיע כאן עם נתונים אמיתיים בלבד.</p><button className="primary-button" onClick={onConnect}><Plus size={16} /> חיבור חנות Shopify</button></div>}
    <div className="security-note"><LockKeyhole size={20} /><div><strong>כל חנות רואה רק את המידע שלה</strong><p>פרטי החיבור נשמרים מוצפנים. רק בעל הפלטפורמה יכול לחבר חנות או להחליף הרשאות.</p></div></div>
  </div>;
}

function EmployeesScreen({ employees, activity, settings, stores, onSync, syncing, syncProgress, onCreate, onUpdate, onSaveSettings }: { employees: Employee[]; activity: EmployeeDiscountActivity; settings: EmployeeMonitoringSettings; stores: Store[]; onSync: (storeId: string) => Promise<void>; syncing: boolean; syncProgress: string | null; onCreate: (input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) => Promise<void>; onUpdate: (id: string, input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) => Promise<Employee>; onSaveSettings: (input: EmployeeMonitoringSettings) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(settings);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [availableCoupons, setAvailableCoupons] = useState<string[]>([]);
  const [couponSource, setCouponSource] = useState<"shopify" | "orders" | null>(null);
  const [scanningCoupons, setScanningCoupons] = useState(false);
  const [couponStoreId, setCouponStoreId] = useState(stores[0]?.id ?? "");
  const [couponSearch, setCouponSearch] = useState("");
  const [employeeCodesOnly, setEmployeeCodesOnly] = useState(false);
  const [visibleCouponCount, setVisibleCouponCount] = useState(50);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeEditSaving, setEmployeeEditSaving] = useState(false);
  const [employeeEditError, setEmployeeEditError] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const scanCoupons = async () => {
    if (!draft.couponPrefix || !couponStoreId) { setSettingsNotice("יש להזין תחילית ולבחור חנות."); return; }
    setScanningCoupons(true); setSettingsNotice("");
    try {
      const response = await fetch(`/api/tenants/${tenantId}/employee-coupons?storeId=${encodeURIComponent(couponStoreId)}&prefix=${encodeURIComponent(draft.couponPrefix)}`);
      const payload = await response.json() as { codes?: string[]; source?: "shopify" | "orders"; warning?: "permission" | "connection" | "scan_failed"; partial?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "SCAN_FAILED");
      setAvailableCoupons(payload.codes ?? []);
      setCouponSource(payload.source ?? null);
      setSettingsNotice(payload.warning === "permission" ? "לחיבור Shopify חסרה הרשאת read_discounts. מוצגים רק קודים שכבר הופיעו בהזמנות; רשימת הקודים שטרם שימשו אינה זמינה."
        : payload.warning === "connection" ? "לא ניתן לקרוא כרגע את רשימת ההנחות מ־Shopify. מוצגים רק קודים שכבר הופיעו בהזמנות; בדוק את חיבור החנות."
          : payload.warning ? "סריקת רשימת ההנחות נכשלה. מוצגים רק קודים שכבר הופיעו בהזמנות."
            : `נמצאו ${(payload.codes ?? []).length} קודים בתחילית${payload.partial ? " · הסריקה חלקית כי קיימים קודים נוספים ב־Shopify" : ""}.`);
    } catch (cause) { setSettingsNotice(cause instanceof Error && /access|scope|permission/i.test(cause.message) ? "לסריקת קופונים נדרשת הרשאת read_discounts בחיבור Shopify." : "לא ניתן לסרוק קופונים כרגע. בדוק את חיבור החנות."); }
    finally { setScanningCoupons(false); }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      await onCreate({ name: String(form.get("name") ?? ""), email: String(form.get("workEmail") ?? ""), privateEmail: String(form.get("privateEmail") ?? ""), address: String(form.get("address") ?? ""), couponCodes: String(form.get("couponCodes") ?? "").split(/[\s,;]+/).filter(Boolean), department: String(form.get("department") ?? "") });
      setAdding(false);
    } catch { setError("לא ניתן להוסיף את העובד. ייתכן שהאימייל כבר קיים."); }
    finally { setSaving(false); }
  };
  const matchingCoupons = activity.codes.filter((item) =>
    item.code.includes(couponSearch.trim().toLowerCase()) && (!employeeCodesOnly || Boolean(activity.prefix && item.code.startsWith(activity.prefix.toLowerCase()))));
  const visibleCoupons = matchingCoupons.slice(0, visibleCouponCount);
  return <div className="page-content product-page employees-page"><PageHeading eyebrow="בדיקה פנימית" title="הטבות ורכישות עובדים" description="מעקב אחר קודי הנחה לעובדים, ההזמנות שבהן השתמשו בהם והתאמות לפרטי עובדים. קוד הנחה אינו גיפטקארד." action={<button className="primary-button" onClick={() => setAdding((value) => !value)}><Plus size={16} /> הוספת עובד לניטור</button>} />
    <section className="compact-overview"><div><span>עובדים בניטור</span><strong>{employees.length}</strong><small>פרטי קשר וקודים משויכים</small></div><div><span>הזמנות עם קוד הנחה</span><strong>{activity.totalOrders.toLocaleString("he-IL")}</strong><small>ב־30 הימים האחרונים</small></div><div><span>קודים שונים שנוצלו</span><strong>{activity.codes.length.toLocaleString("he-IL")}</strong><small>מתוך ההזמנות שנקלטו</small></div></section>
    <section className="employee-discount-section" aria-labelledby="employee-discount-title"><div className="section-heading"><div><h2 id="employee-discount-title">שימוש בקודי הנחה</h2><span>כל הקודים שנמצאו בהזמנות ב־30 הימים האחרונים, לא רק קודי עובדים</span></div></div><div className="employee-discount-tools"><span>{activity.ordersWithAnyDiscountCode.toLocaleString("he-IL")} הזמנות עם קוד הנחה מתוך {activity.ordersChecked.toLocaleString("he-IL")} שנקלטו</span></div>
      <div className="employee-coupon-filters"><label className="employee-coupon-search"><Search size={17} aria-hidden="true" /><input type="search" dir="ltr" aria-label="חיפוש קוד הנחה" placeholder="חיפוש קוד הנחה" value={couponSearch} onChange={(event) => { setCouponSearch(event.target.value); setVisibleCouponCount(50); }} /></label><label className="employee-coupon-only"><input type="checkbox" checked={employeeCodesOnly} disabled={!activity.prefix} onChange={(event) => { setEmployeeCodesOnly(event.target.checked); setVisibleCouponCount(50); }} /> קודי עובדים בלבד{activity.prefix ? ` (${activity.prefix.toUpperCase()})` : ""}</label><span className="employee-coupon-count">{matchingCoupons.length.toLocaleString("he-IL")} קודים</span></div>
      {visibleCoupons.length ? <><div className="employee-code-list"><div className="employee-code-row employee-code-head"><span>קוד הנחה</span><span>שיוך לעובד</span><span>שימושים</span><span>שימוש אחרון</span></div>{visibleCoupons.map((item) => { const owner = employees.find((employee) => employee.id === item.assignedEmployeeId); return <div className="employee-code-row" key={item.code}><strong dir="ltr">{item.code}</strong><span>{owner ? `משויך ל${owner.name}` : item.assignmentConflict ? "משויך לכמה עובדים" : "—"}</span><bdi>{item.orders.toLocaleString("he-IL")}</bdi><time dateTime={item.lastUsedAt}>{new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(new Date(item.lastUsedAt))}</time></div>; })}</div>{matchingCoupons.length > visibleCouponCount ? <button className="secondary-button employee-coupon-more" onClick={() => setVisibleCouponCount((count) => count + 50)}>הצג עוד 50 קודים</button> : null}<details className="employee-discount-orders"><summary>הצג שימושים אחרונים ({activity.recentUses.length}) <ChevronDown size={16} /></summary><p className="context-note">מוצגים עד 100 השימושים האחרונים. ספירת השימושים לכל קוד למעלה כוללת את כל 30 הימים.</p><div className="table-wrap"><table className="case-table"><thead><tr><th>תאריך</th><th>קוד הנחה</th><th>הזמנה</th><th>רוכש</th><th>קשר לעובד</th><th>סכום הזמנה</th></tr></thead><tbody>{activity.recentUses.map((use) => { const owner = employees.find((employee) => employee.id === use.assignedEmployeeId); return <tr key={`${use.storeId}:${use.orderId}:${use.code}`}><td>{new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(use.createdAt))}</td><td dir="ltr">{use.code}</td><td>{use.orderNumber ?? `#${use.orderId.split("/").at(-1)}`}</td><td dir="ltr">{use.email || "לא התקבל"}</td><td>{use.assignmentConflict ? "קוד משויך לכמה עובדים" : owner ? use.buyerMatchesEmployee ? `תואם ל${owner.name}` : use.buyerIdentityAvailable ? `קוד של ${owner.name} · פרטי רוכש אחרים` : `קוד של ${owner.name} · אין פרטי רוכש לאימות` : "קוד לא משויך"}</td><td>{formatCurrency(use.amount)}</td></tr>; })}</tbody></table></div></details></> : <div className="employee-discount-empty"><strong>{couponSearch || employeeCodesOnly ? "אין קודים התואמים לחיפוש" : "לא נמצאו שימושים בקודי הנחה"}</strong><span>{couponSearch || employeeCodesOnly ? "אפשר לשנות את החיפוש או להציג את כל הקודים." : activity.ordersChecked === 0 ? "עדיין לא נקלטו הזמנות ב־30 הימים האחרונים." : "בהזמנות שנקלטו לא נמצאו קודי הנחה."}</span></div>}
    </section>
    <section className="employee-monitoring-settings"><div className="section-heading"><div><h2>הגדרות ניטור עובדים</h2><span>קודי הנחה והזמנות עובדים · בנפרד מחוקי הסיכון הכלליים</span></div></div><h3 className="employee-settings-subtitle">קודי הנחה לעובדים</h3><div className="employee-rules-grid">
      <label>תחילית קודי הנחה לעובדים<input dir="ltr" value={draft.couponPrefix} onChange={(event) => setDraft({ ...draft, couponPrefix: event.target.value })} placeholder="OVED" /></label>
      <label>חנות לסריקת קודי הנחה<select value={couponStoreId} onChange={(event) => setCouponStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    </div><div className="employee-settings-actions"><button className="primary-button" onClick={() => void onSaveSettings(draft).then(() => setSettingsNotice("הגדרות ניטור העובדים נשמרו.")).catch(() => setSettingsNotice("שמירת ההגדרות נכשלה."))}>שמור הגדרות</button></div><p className="context-note">רשימת השימושים למעלה מתעדכנת מההזמנות שנקלטו; אין צורך לסרוק את כל ההנחות כדי לראות אותה.</p><details className="employee-secondary-rules"><summary>סריקה ורענון ידניים <ChevronDown size={16} /></summary><p className="context-note">סריקת קודים קיימים שלא נוצלו דורשת הרשאת Shopify מתאימה. רענון הזמנות של 30 יום עשוי לקחת כמה דקות.</p><div className="employee-settings-actions"><button className="secondary-button" onClick={() => void scanCoupons()} disabled={scanningCoupons}>{scanningCoupons ? "סורק…" : "אתר גם קודים שלא נוצלו"}</button><button className="secondary-button" onClick={() => couponStoreId && void onSync(couponStoreId)} disabled={!couponStoreId || syncing}><RefreshCcw size={15} /> {syncing ? "מרענן הזמנות…" : "רענן הזמנות מ־Shopify"}</button></div>{syncProgress ? <p role="status" className="sync-progress-note">{syncProgress}</p> : null}{availableCoupons.length ? <div className="coupon-results"><strong>{couponSource === "shopify" ? "קודים שנמצאו ב־Shopify" : "קודים שנקלטו בהזמנות"}</strong><p>{availableCoupons.slice(0, 40).join(" · ")}</p><small>{couponSource === "shopify" ? "קוד שקיים בחנות לא בהכרח שימש בהזמנה. שיוך לעובד נעשה בפרטי העובד." : "מוצגים רק קודים שכבר הופיעו בהזמנות שנקלטו."}</small></div> : null}</details>{settingsNotice ? <p role="status">{settingsNotice}</p> : null}<details className="employee-secondary-rules"><summary>בדיקות נוספות לעובדים <ChevronDown size={16} /></summary><div className="employee-rules-grid">
      <label><input type="checkbox" checked={draft.zeroAmount} onChange={(event) => setDraft({ ...draft, zeroAmount: event.target.checked })} /> התראה על הזמנה בסכום ₪0 עם התאמה לעובד</label>
      <label><input type="checkbox" checked={draft.giftCardAddressChange} onChange={(event) => setDraft({ ...draft, giftCardAddressChange: event.target.checked })} /> התראה כשגיפטקארד הקשור לעובד ממומש בכתובת אחרת</label>
      <label><input type="checkbox" checked={draft.repeatGiftCardUses} onChange={(event) => setDraft({ ...draft, repeatGiftCardUses: event.target.checked })} /> התראה על מימושים חוזרים של גיפטקארדים הקשורים לעובד</label>
      <label>מספר מימושים<input type="number" min="2" value={draft.repeatUsesThreshold} onChange={(event) => setDraft({ ...draft, repeatUsesThreshold: Number(event.target.value) })} /></label>
      <label>חלון זמן בשעות<input type="number" min="1" value={Math.max(1, draft.windowMinutes / 60)} onChange={(event) => setDraft({ ...draft, windowMinutes: Number(event.target.value) * 60 })} /></label>
    </div><p className="context-note">מעקב אחר הנפקה ידנית של גיפטקארד עדיין אינו פעיל; הוא דורש גישה למאגר הכרטיסים של Shopify.</p></details></section>
    {adding ? <form className="employee-form" onSubmit={submit}><label>שם מלא<input name="name" required placeholder="שם העובד" /></label><label>אימייל עבודה<input name="workEmail" required type="email" dir="ltr" placeholder="employee@company.co.il" /></label><label>אימייל פרטי<input name="privateEmail" type="email" dir="ltr" placeholder="name@gmail.com" /></label><label>כתובת<input name="address" placeholder="כתובת העובד להשוואת הזמנות" /></label><label>קודי קופון משויכים<input name="couponCodes" dir="ltr" placeholder="oved30, ovedtx" /><small>אפשר להפריד בין קודים בפסיק</small></label><label>מחלקה<input name="department" required placeholder="למשל שירות לקוחות" /></label><button className="primary-button" disabled={saving}>{saving ? "שומר…" : "הוסף לניטור"}</button>{error ? <p role="alert">{error}</p> : null}</form> : null}
    <section className="case-section"><div className="section-heading"><div><h2>עובדים בניטור</h2><span>פרטי זיהוי וקודי הנחה המשויכים לכל עובד</span></div></div><div className="table-wrap"><table className="case-table"><thead><tr><th>עובד</th><th>קודי הנחה</th><th>הזמנות קשורות</th><th>זיכויים שנמצאו</th><th>מצב לבדיקה</th><th /></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.name}</strong><small>{employee.email}</small></td><td dir="ltr">{employee.couponCodes?.length ? employee.couponCodes.join(", ") : "—"}</td><td className="mono">{employee.purchases}</td><td className="mono">{employee.refunded}</td><td><SeverityBadge severity={employee.risk} /></td><td><button className="icon-button" onClick={() => setSelectedEmployee(employee)} aria-label={`פרטי ${employee.name}`}><ChevronLeft size={16} /></button></td></tr>)}</tbody></table>{employees.length === 0 ? <div className="empty-state"><UsersRound size={25} /><strong>לא נוספו עובדים לניטור</strong><span>אפשר להוסיף עובד ידנית ולשייך אליו קודי הנחה.</span></div> : null}</div></section>
    {selectedEmployee ? <CenteredDialog className="employee-detail-dialog" label={`פרטי ${selectedEmployee.name}`} onClose={() => setSelectedEmployee(null)}>
      <header className="drawer-header"><h2>עריכת {selectedEmployee.name}</h2><button className="icon-button" onClick={() => setSelectedEmployee(null)} aria-label="סגירה"><X size={19} /></button></header>
      <form className="employee-detail-body employee-form" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setEmployeeEditSaving(true); setEmployeeEditError("");
        try {
          const updated = await onUpdate(selectedEmployee.id, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), privateEmail: String(form.get("privateEmail") ?? ""), address: String(form.get("address") ?? ""), couponCodes: String(form.get("couponCodes") ?? "").split(/[\s,;]+/).filter(Boolean), department: String(form.get("department") ?? "") });
          setSelectedEmployee(updated);
          setSelectedEmployee(null);
        } catch { setEmployeeEditError("שמירת העובד נכשלה. בדוק אימייל כפול ונסה שוב."); }
        finally { setEmployeeEditSaving(false); }
      }}>
        <label>שם מלא<input name="name" defaultValue={selectedEmployee.name} required /></label>
        <label>אימייל עבודה<input name="email" type="email" dir="ltr" defaultValue={selectedEmployee.email} required /></label>
        <label>אימייל פרטי<input name="privateEmail" type="email" dir="ltr" defaultValue={selectedEmployee.privateEmail ?? ""} /></label>
        <label>כתובת<input name="address" defaultValue={selectedEmployee.address ?? ""} /></label>
        <label>קופונים משויכים<input name="couponCodes" dir="ltr" defaultValue={selectedEmployee.couponCodes?.join(", ") ?? ""} /></label>
        <label>מחלקה<input name="department" defaultValue={selectedEmployee.department} required /></label>
        {employeeEditError ? <p role="alert">{employeeEditError}</p> : null}
        <button className="primary-button" disabled={employeeEditSaving}>{employeeEditSaving ? "שומר…" : "שמור שינויים"}</button>
      </form>
    </CenteredDialog> : null}
  </div>;
}

const conditionFields: { value: RiskConditionField; label: string; boolean?: boolean; suffix?: string }[] = [
  { value: "orders_by_email", label: "מספר הזמנות מאותו אימייל", suffix: "הזמנות" },
  { value: "orders_by_ip", label: "מספר הזמנות מאותה כתובת IP", suffix: "הזמנות" },
  { value: "orders_by_phone", label: "מספר הזמנות מאותו טלפון", suffix: "הזמנות" },
  { value: "gift_card_orders_by_ip", label: "רכישות Gift Card מאותה כתובת IP", suffix: "הזמנות" },
  { value: "gift_card_orders_by_email", label: "רכישות Gift Card מאותו אימייל", suffix: "הזמנות" },
  { value: "gift_card_orders_by_phone", label: "רכישות Gift Card מאותו טלפון", suffix: "הזמנות" },
  { value: "emails_by_ip", label: "מספר אימיילים שונים מאותה כתובת IP", suffix: "אימיילים" },
  { value: "identities_by_phone", label: "מספר אימיילים לאותו טלפון", suffix: "זהויות" },
  { value: "order_amount", label: "סכום ההזמנה", suffix: "₪" },
  { value: "order_amount_vs_average", label: "סכום ביחס לממוצע החנות", suffix: "פי הממוצע" },
  { value: "gift_card_value", label: "שווי Gift Cards", suffix: "₪" },
  { value: "linked_gift_card", label: "Gift Card שמומש בזהות אחרת", suffix: "", boolean: true },
  { value: "payment_failures", label: "ניסיונות תשלום כושלים", suffix: "ניסיונות" },
  { value: "network_match", label: "התאמה למאגר המשותף", boolean: true },
  { value: "employee_match", label: "הלקוח מופיע ברשימת העובדים", boolean: true },
  { value: "refund_after_fulfillment", label: "זיכוי לאחר מסירת הסחורה", boolean: true },
  { value: "billing_shipping_mismatch", label: "כתובות חיוב ומשלוח שונות", boolean: true },
  { value: "order_local_hour", label: "הזמנה בשעות הלילה", boolean: true },
];

const conditionSentence = (condition: RiskCondition) => {
  const field = conditionFields.find((item) => item.value === condition.field);
  if (!field) return "תנאי לא ידוע";
  if (condition.field === "order_local_hour") return `שעת הזמנה ${String(condition.startHour ?? 0).padStart(2, "0")}:00–${String(condition.endHour ?? 5).padStart(2, "0")}:00`;
  if (field.boolean) return field.label;
  const window = condition.windowMinutes ? ` בתוך ${condition.windowMinutes % 10080 === 0 ? `${condition.windowMinutes / 10080} שבועות` : condition.windowMinutes % 1440 === 0 ? `${condition.windowMinutes / 1440} ${condition.windowMinutes === 1440 ? "יום" : "ימים"}` : condition.windowMinutes % 60 === 0 ? `${condition.windowMinutes / 60} ${condition.windowMinutes === 60 ? "שעה" : "שעות"}` : `${condition.windowMinutes} דקות`}` : "";
  const comparison = condition.operator === "gt" ? "יותר מ־" : condition.operator === "eq" ? "בדיוק " : "לפחות ";
  return `${field.label} ${comparison}${condition.value} ${field.suffix ?? ""}${condition.minGiftCardValue ? `, רק כאשר שווי הגיפטקארדים ברכישה מעל ₪${condition.minGiftCardValue}` : ""}${window}`;
};

const recommendedTemplates: Omit<RiskRule, "id" | "matches">[] = [
  {
    label: "תשלום כושל והזמנה גדולה", description: "שילוב מומלץ שמפחית התראות שווא", category: "payment", enabled: false, logic: "all",
    conditions: [{ id: "template-payments", field: "payment_failures", operator: "gte", value: 3, windowMinutes: 30 }, { id: "template-aov", field: "order_amount_vs_average", operator: "gte", value: 3 }],
    action: { severity: "high", openCase: true, emailOwner: true }, recommended: true,
  },
  {
    label: "זהויות מרובות ורכישת Gift Card", description: "שילוב חזק לזיהוי התחזות ורכישה חוזרת", category: "identity", enabled: false, logic: "all",
    conditions: [{ id: "template-identities", field: "identities_by_phone", operator: "gte", value: 3, windowMinutes: 1440 }, { id: "template-gift", field: "gift_card_value", operator: "gte", value: 1000, windowMinutes: 120 }],
    action: { severity: "critical", openCase: true, emailOwner: true }, recommended: true,
  },
];

function RulesScreen({ rules, onToggle, onSave, onCreate }: { rules: RiskRule[]; onToggle: (rule: RiskRule) => Promise<RuleReconciliation>; onSave: (rule: RiskRule) => Promise<RuleReconciliation>; onCreate: (rule: Omit<RiskRule, "id" | "matches">) => Promise<void> }) {
  const [editing, setEditing] = useState<RiskRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const visibleRules = rules.filter((rule) => rule.enabled || !["recommended-ip-velocity", "recommended-email-velocity", "recommended-phone-hourly-velocity", "recommended-email-daily-velocity", "recommended-ip-daily-velocity", "recommended-phone-daily-velocity", "recommended-gift-card-ip-velocity"].includes(rule.id));
  const ruleGroups = [
    { id: "velocity", title: "ריבוי הזמנות", hint: "לפי אימייל, IP או טלפון · שעה ויום", rules: visibleRules.filter((rule) => rule.category === "velocity") },
    { id: "gift-card", title: "גיפטקארדים", hint: "רכישות חוזרות, סכום ומימוש", rules: visibleRules.filter((rule) => rule.category === "gift-card") },
    { id: "payment", title: "סכומי הזמנה ותשלום", hint: "ספי סכום, תשלום ושעות הלילה", rules: visibleRules.filter((rule) => rule.category === "payment") },
    { id: "identity", title: "זהויות מקושרות", hint: "התאמות בין פרטי קשר", rules: visibleRules.filter((rule) => rule.category === "identity") },
    { id: "network", title: "המאגר המשותף", hint: "התאמות לדיווחי הונאה", rules: visibleRules.filter((rule) => rule.category === "network") },
    { id: "other", title: "חוקים נוספים", hint: "כללים מותאמים", rules: visibleRules.filter((rule) => !["velocity", "gift-card", "payment", "identity", "network"].includes(rule.category)) },
  ].filter((group) => group.rules.length);
  const [notice, setNotice] = useState("");

  const updateCondition = (id: string, patch: Partial<RiskCondition>) => setEditing((current) => current ? { ...current, conditions: current.conditions.map((condition) => condition.id === id ? { ...condition, ...patch } : condition) } : current);
  const addCondition = () => setEditing((current) => current ? { ...current, conditions: [...current.conditions, { id: crypto.randomUUID(), field: "orders_by_email", operator: "gte", value: 3, windowMinutes: 60 }] } : current);
  const save = async () => {
    if (!editing) return;
    setSaving(true); setError("");
    try { const result = await onSave(editing); setNotice(`החוק נשמר ונבדקו ${result.reviewed} תיקים · ${result.resolved} נסגרו · ${result.reopened} נפתחו מחדש · ${result.active} פעילות`); setEditing(null); } catch { setError("החוק לא נשמר. בדוק שכל התנאים מלאים ונסה שוב."); }
    finally { setSaving(false); }
  };
  const addTemplate = async (template: Omit<RiskRule, "id" | "matches">) => {
    setSaving(true); setError("");
    try { await onCreate({ ...template, enabled: true, conditions: template.conditions.map((condition) => ({ ...condition, id: crypto.randomUUID() })) }); }
    catch { setError("לא ניתן להוסיף את החוק כרגע."); }
    finally { setSaving(false); }
  };

  return <div className="page-content product-page rules-page"><PageHeading eyebrow="כללים אוטומטיים" title="מתי לפתוח התראה?" description="בונים תנאים פשוטים או משלבים כמה תנאים. כשהחוק מתקיים נפתח תיק ונשלח אימייל לפי ההגדרות שלך." action={<button className="primary-button" onClick={() => void addTemplate({ label: "חוק חדש", description: "חוק מותאם לחנות", category: "velocity", enabled: true, logic: "all", conditions: [{ id: crypto.randomUUID(), field: "orders_by_email", operator: "gte", value: 3, windowMinutes: 60 }], action: { severity: "high", openCase: true, emailOwner: true } })}><Plus size={16} /> חוק חדש</button>} />
    <div className="rule-summary"><div><span>חוקים פעילים</span><strong>{rules.filter((rule) => rule.enabled).length}</strong></div><div><span>התראות שנפתחו</span><strong>{rules.reduce((sum, rule) => sum + rule.matches, 0)}</strong></div><div><span>חוקים משולבים</span><strong>{rules.filter((rule) => rule.conditions.length > 1).length}</strong></div></div>

    <section className="recommendations"><div className="recommendation-heading"><div><Sparkles size={18} /><div><strong>המלצות מוכנות</strong><span>שילובים נפוצים שמפחיתים התראות שווא</span></div></div></div><div className="recommendation-grid">{recommendedTemplates.map((template) => <article key={template.label}><div><strong>{template.label}</strong><p>{template.description}</p></div><button className="secondary-button" onClick={() => void addTemplate(template)} disabled={saving}><PlusCircle size={15} /> הוסף לחנות</button></article>)}</div></section>

    {notice ? <div className="rule-recalculation-notice" role="status"><CheckCircle2 size={17} /><div><strong>ההתראות חושבו מחדש</strong><span>{notice}</span></div></div> : null}
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    <div className="rule-groups">{ruleGroups.map((group, index) => <details className="rule-group" key={group.id} ref={(element) => { if (element && !element.dataset.initialized) { element.open = index === 0; element.dataset.initialized = "true"; } }}><summary><span><strong>{group.title}</strong><small>{group.hint}</small></span><span>{group.rules.filter((rule) => rule.enabled).length} פעילים · {group.rules.length} כללים <ChevronDown size={17} /></span></summary><div className="rules-list condition-rules">{group.rules.map((rule) => <article key={rule.id} className={!rule.enabled ? "rule-disabled" : ""}>
      <button role="switch" aria-checked={rule.enabled} className={`switch ${rule.enabled ? "switch-on" : ""}`} onClick={() => void onToggle(rule).then((result) => setNotice(`החוק ${rule.enabled ? "כובה" : "הופעל"} ונבדקו ${result.reviewed} תיקים · ${result.resolved} נסגרו · ${result.reopened} נפתחו מחדש · ${result.active} פעילות`)).catch(() => setError("החוק לא עודכן. נסה שוב."))} aria-label={`${rule.enabled ? "כיבוי" : "הפעלת"} ${rule.label}`}><span /></button>
      <div className="rule-main"><div><h3>{["recommended-order-high", "recommended-order-critical"].includes(rule.id) ? `סכום הזמנה · ${rule.conditions[0] ? conditionSentence(rule.conditions[0]) : rule.label}` : rule.label}</h3>{rule.locked ? <span className="locked-chip"><LockKeyhole size={12} /> חוק מערכת</span> : null}</div><div className="condition-preview"><span className="logic-word">{rule.logic === "all" ? "כל התנאים" : "אחד מהתנאים"}</span>{rule.conditions.map((condition) => <span key={condition.id}>{conditionSentence(condition)}</span>)}</div></div>
      <div className="rule-action"><span>אז</span><strong>{rule.action.openCase ? `פתח תיק · ${rule.action.severity === "critical" ? "קריטי" : rule.action.severity === "high" ? "גבוה" : rule.action.severity === "medium" ? "בינוני" : "נמוך"}` : `הוסף ${rule.action.scoreBonus ?? 0} נקודות סיכון`}</strong><small>{rule.action.openCase ? rule.action.emailOwner ? "ושלח אימייל לבעלים" : "ללא אימייל" : "אות משלים · לא פותח תיק לבדו"}</small></div>
      <div className="rule-matches"><span>הופעל</span><strong className="mono">{rule.matches}</strong><small>פעמים</small></div>
      <button className="secondary-button" onClick={() => setEditing(structuredClone(rule))} disabled={rule.locked}>עריכת תנאים</button>
    </article>)}</div></details>)}</div>

    {editing ? <CenteredDialog className="rule-editor" label={`עריכת החוק ${editing.label}`} onClose={() => setEditing(null)}><header><div><span className="eyebrow">עריכת חוק</span><h2>{editing.label}</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="סגירת עורך החוק"><X size={19} /></button></header><div className="rule-editor-body">
      <label className="field-label">שם החוק<input value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} /></label>
      <label className="field-label">הפעל את ההתראה כאשר<select value={editing.logic} onChange={(event) => setEditing({ ...editing, logic: event.target.value as "all" | "any" })}><option value="all">כל התנאים מתקיימים</option><option value="any">לפחות תנאי אחד מתקיים</option></select></label>
      {["recommended-orders-hour", "recommended-orders-day", "recommended-gift-card-repeat-100"].includes(editing.id) ? <fieldset className="identity-selector"><legend>לפי אילו פרטים לזהות ריבוי? התאמה באחד מהם תפעיל את החוק</legend>{(["ip", "email", "phone"] as const).map((identity) => {
        const field = `${editing.id === "recommended-gift-card-repeat-100" ? "gift_card_orders_by" : "orders_by"}_${identity}` as RiskConditionField;
        return <label key={identity}><input type="checkbox" checked={editing.conditions.some((condition) => condition.field === field)} onChange={(event) => {
          const conditions = event.target.checked
            ? [...editing.conditions, { id: crypto.randomUUID(), field, operator: editing.conditions[0]?.operator ?? "gt", value: editing.conditions[0]?.value ?? 3, windowMinutes: editing.conditions[0]?.windowMinutes ?? 60, minGiftCardValue: editing.id === "recommended-gift-card-repeat-100" ? 100 : undefined } satisfies RiskCondition]
            : editing.conditions.filter((condition) => condition.field !== field);
          if (conditions.length) setEditing({ ...editing, logic: "any", conditions });
        }} /> {identity === "ip" ? "IP" : identity === "email" ? "אימייל" : "טלפון"}</label>;
      })}</fieldset> : null}
      <div className="condition-editor-list">{editing.conditions.map((condition, index) => {
        const field = conditionFields.find((item) => item.value === condition.field);
        const isVelocity = ["orders_by_email", "orders_by_ip", "orders_by_phone", "gift_card_orders_by_ip", "gift_card_orders_by_email", "gift_card_orders_by_phone", "emails_by_ip", "identities_by_phone"].includes(condition.field);
        const isGiftRepeat = condition.field.startsWith("gift_card_orders_by_");
        const minutes = condition.windowMinutes ?? 60;
        const unit = minutes % 10080 === 0 ? 10080 : minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
        return <div className="condition-editor" key={condition.id}>
          <span className="condition-number">{index + 1}</span>
          <select aria-label={`סוג תנאי ${index + 1}`} value={condition.field} onChange={(event) => {
            const nextField = event.target.value as RiskConditionField;
            const nextMeta = conditionFields.find((item) => item.value === nextField);
            const timed = ["orders_by_email", "orders_by_ip", "orders_by_phone", "gift_card_orders_by_ip", "gift_card_orders_by_email", "gift_card_orders_by_phone", "emails_by_ip", "identities_by_phone"].includes(nextField);
            updateCondition(condition.id, { field: nextField, value: nextMeta?.boolean ? true : 1, windowMinutes: timed ? condition.windowMinutes ?? 60 : undefined, startHour: nextField === "order_local_hour" ? 0 : undefined, endHour: nextField === "order_local_hour" ? 5 : undefined, minGiftCardValue: nextField.startsWith("gift_card_orders_by_") ? 100 : undefined });
            if (nextField === "order_local_hour") setEditing((current) => current ? { ...current, action: { ...current.action, openCase: false, emailOwner: false, scoreBonus: 5 } } : current);
          }}>{conditionFields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {condition.field === "order_local_hour" ? <>
            <label className="condition-value-field"><span>משעה</span><input type="number" aria-label="משעה" min="0" max="23" value={condition.startHour ?? 0} onChange={(event) => updateCondition(condition.id, { startHour: Number(event.target.value) })} /></label>
            <label className="condition-value-field"><span>עד שעה</span><input type="number" aria-label="עד שעה" min="0" max="23" value={condition.endHour ?? 5} onChange={(event) => updateCondition(condition.id, { endHour: Number(event.target.value) })} /></label>
          </> : field?.boolean ? <span className="boolean-condition">כן, התנאי מתקיים</span> : <>
            <label className="condition-value-field"><span>{condition.operator === "gt" ? "יותר מ־" : condition.operator === "eq" ? "בדיוק" : "לפחות"}</span><input aria-label="ערך סף" type="number" min="0" value={String(condition.value)} onChange={(event) => updateCondition(condition.id, { value: Number(event.target.value) })} /></label>
            {isGiftRepeat ? <label className="condition-value-field"><span>שווי Gift Card ברכישה מעל ₪</span><input aria-label="סכום מינימלי ברכישה" type="number" min="0" value={condition.minGiftCardValue ?? 100} onChange={(event) => updateCondition(condition.id, { minGiftCardValue: Number(event.target.value) })} /></label> : null}
            {isVelocity ? <label className="condition-value-field condition-window-field"><span>בתוך</span><input aria-label="חלון זמן" type="number" min="1" value={minutes / unit} onChange={(event) => updateCondition(condition.id, { windowMinutes: Math.max(1, Number(event.target.value)) * unit })} /><select aria-label="יחידת זמן" value={unit} onChange={(event) => updateCondition(condition.id, { windowMinutes: Math.max(1, Math.ceil(minutes / unit)) * Number(event.target.value) })}><option value={1}>דקות</option><option value={60}>שעות</option><option value={1440}>ימים</option><option value={10080}>שבועות</option></select></label> : null}
          </>}
          {editing.conditions.length > 1 ? <button className="icon-button" onClick={() => setEditing({ ...editing, conditions: editing.conditions.filter((item) => item.id !== condition.id) })} aria-label="הסרת תנאי"><X size={15} /></button> : null}
        </div>;
      })}</div>
      <button className="add-condition-button" onClick={addCondition}><Plus size={15} /> הוסף תנאי נוסף</button>
      <div className="rule-outcome"><strong>כאשר החוק מתקיים</strong>{editing.conditions.some((condition) => condition.field === "order_local_hour") ? <label className="condition-value-field"><span>תוספת נקודות לציון הסיכון</span><input type="number" min="0" max="20" value={editing.action.scoreBonus ?? 5} onChange={(event) => setEditing({ ...editing, action: { ...editing.action, scoreBonus: Number(event.target.value), openCase: false, emailOwner: false } })} /></label> : null}<label><span>חומרת ההתראה</span><select value={editing.action.severity} onChange={(event) => setEditing({ ...editing, action: { ...editing.action, severity: event.target.value as Severity } })}><option value="medium">בינוני</option><option value="high">גבוה</option><option value="critical">קריטי</option></select></label>{!editing.conditions.some((condition) => condition.field === "order_local_hour") ? <label className="checkbox-row"><input type="checkbox" checked={editing.action.emailOwner} onChange={(event) => setEditing({ ...editing, action: { ...editing.action, emailOwner: event.target.checked } })} /> שלח אימייל לבעלי החנות</label> : null}</div>
    </div><footer><button className="secondary-button" onClick={() => setEditing(null)}>ביטול</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "שומר…" : "שמור חוק"}</button></footer></CenteredDialog> : null}
  </div>;
}

function NotificationsScreen({ settings, deliveries, onSave }: { settings: NotificationSettings; deliveries: NotificationDelivery[]; onSave: (settings: NotificationSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipientError, setRecipientError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(settings); }, [settings]);
  const toggleSeverity = (severity: Severity) => setDraft((current) => ({ ...current, severities: current.severities.includes(severity) ? current.severities.filter((item) => item !== severity) : [...current.severities, severity] }));
  const addRecipient = () => {
    const email = recipientInput.trim().toLowerCase();
    if (!email) return true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setRecipientError("יש להזין כתובת אימייל תקינה."); return false; }
    setDraft((current) => ({ ...current, recipients: [...new Set([...current.recipients, email])] }));
    setRecipientInput(""); setRecipientError(""); setSaved(false);
    return true;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const pendingEmail = recipientInput.trim().toLowerCase();
    if (!addRecipient()) return;
    const recipients = [...new Set([...draft.recipients, ...(pendingEmail ? [pendingEmail] : [])])];
    if (draft.enabled && recipients.length === 0) { setRecipientError("כדי להפעיל התראות צריך להוסיף לפחות כתובת אחת."); return; }
    setSaving(true); setSaved(false); setRecipientError("");
    try { await onSave({ ...draft, recipients }); setSaved(true); }
    catch { setRecipientError("לא ניתן לשמור את הגדרות האימייל כרגע."); }
    finally { setSaving(false); }
  };
  return <div className="page-content product-page notifications-page"><PageHeading eyebrow="התראות לבעלי החנות" title="מי מקבל אימייל ומתי?" description="כשנפתח תיק בסיכון שבחרת, כל נמען מקבל אימייל עם הסיבה וקישור ישיר לקבלת החלטה." />
    <div className="notification-layout"><form className="notification-settings" onSubmit={submit}>
      <div className="notification-master"><div><Mail size={20} /><div><strong>שליחת התראות באימייל</strong><span>התראות על הזמנות הדורשות בדיקה</span></div></div><button type="button" role="switch" aria-checked={draft.enabled} className={`notification-toggle ${draft.enabled ? "is-on" : ""}`} onClick={() => { setDraft({ ...draft, enabled: !draft.enabled }); setSaved(false); }} aria-label="הפעלת התראות"><span className="notification-toggle-track"><i /></span><strong>{draft.enabled ? "פעיל" : "כבוי"}</strong></button></div>
      <div className="recipient-field"><label htmlFor="recipient-email">כתובות בעלי החנות <small>הוסף כתובת אחת בכל פעם</small></label><div className="recipient-entry"><input id="recipient-email" type="email" dir="ltr" value={recipientInput} onChange={(event) => { setRecipientInput(event.target.value); setRecipientError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRecipient(); } }} placeholder="owner@gmail.com" /><button type="button" className="secondary-button" onClick={addRecipient}>הוסף כתובת</button></div>{draft.recipients.length ? <ul className="recipient-list" aria-label="נמעני התראות">{draft.recipients.map((email) => <li key={email}><Mail size={15} /><bdi>{email}</bdi><button type="button" onClick={() => { setDraft((current) => ({ ...current, recipients: current.recipients.filter((value) => value !== email) })); setSaved(false); }} aria-label={`הסרת ${email}`}><X size={15} /></button></li>)}</ul> : <p className="context-note">עוד לא נוספו נמענים.</p>}{recipientError ? <p role="alert" className="inline-error">{recipientError}</p> : null}</div>
      <fieldset><legend>על אילו תיקים לשלוח אימייל?</legend><div className="severity-options">{(["critical", "high", "medium"] as Severity[]).map((severity) => <label key={severity} className={`severity-option ${draft.severities.includes(severity) ? "selected" : ""}`}><input type="checkbox" checked={draft.severities.includes(severity)} onChange={() => toggleSeverity(severity)} /><SeverityBadge severity={severity} /><span>{severity === "critical" ? "דורש טיפול מיידי" : severity === "high" ? "חשד משמעותי" : "כדאי לבדוק"}</span></label>)}</div></fieldset>
      <label className="field-label reminder-field">שלח תזכורת אם התיק עדיין לא טופל אחרי<div><input type="number" min="5" max="1440" value={draft.reminderMinutes} onChange={(event) => setDraft({ ...draft, reminderMinutes: Number(event.target.value) })} /><span>דקות</span></div></label>
      <div className="notification-example"><strong>מה קורה בפועל?</strong><ol><li>המערכת מזהה הזמנה חשודה ופותחת תיק.</li><li>בעלי החנות מקבלים אימייל עם הסיבה והסכום.</li><li>הבעלים מסמנים: בבדיקה, טופל, תקין או הונאה.</li></ol></div>
      <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? "שומר…" : "שמור הגדרות"}</button>{saved ? <span className="saved-message" role="status"><CheckCircle2 size={15} /> ההגדרות נשמרו</span> : null}</div>
    </form><section className="delivery-panel"><div className="section-heading"><div><h2>התראות אחרונות</h2><span>סטטוס מסירה לכל נמען</span></div></div>{deliveries.length ? <div className="delivery-list">{deliveries.slice(0, 8).map((delivery) => <article key={delivery.id}><div className="delivery-icon"><Mail size={17} /></div><div><strong>{delivery.recipient}</strong><span>תיק {delivery.caseId}</span></div><span className={`delivery-status delivery-${delivery.status}`}>{delivery.status === "sent" ? "נשלח" : delivery.status === "simulated" ? "לא נשלח — שירות המייל לא הוגדר" : delivery.status === "failed" ? "נכשל" : "בתור"}</span></article>)}</div> : <div className="empty-state"><Mail size={25} /><strong>עדיין לא נשלחו התראות</strong><span>התראות חדשות יופיעו כאן.</span></div>}</section></div>
  </div>;
}

function NetworkScreen({ reports, cases, onRelease }: { reports: BlacklistReport[]; cases: FraudCase[]; onRelease: (caseId: string) => Promise<void> }) {
  const identityLabel: Record<BlacklistReport["keyType"], string> = { email: "אימייל", phone: "טלפון", address: "כתובת", ip: "כתובת IP", customer: "לקוח Shopify" };
  const [releasing, setReleasing] = useState<string | null>(null);
  const activeReports = reports.filter((report) => report.status === "active");
  const groups = Object.values(activeReports.reduce<Record<string, BlacklistReport[]>>((result, report) => {
    (result[report.caseId] ??= []).push(report);
    return result;
  }, {}));
  const release = async (caseId: string) => {
    setReleasing(caseId);
    try { await onRelease(caseId); } finally { setReleasing(null); }
  };
  return <div className="page-content product-page network-page"><PageHeading eyebrow="רשת הגנה משותפת" title="התאמות למאגר ההונאות" description="אם לקוח דווח כהונאה בחנות אחרת, החנות שלך מקבלת התראה — בלי לראות מי דיווח ובלי גישה למאגר עצמו." />
    <div className="network-hero"><div className="network-visual"><div className="network-center"><Shield size={30} /><span>בדיקה פרטית</span></div>{["מייל", "טלפון", "כתובת"].map((label, i) => <div key={label} className={`network-node node-${i + 1}`}><Fingerprint size={17} />{label}</div>)}</div><div><span className="eyebrow">הפרטים נשארים מוגנים</span><h2>מקבלים תשובה, לא את המאגר</h2><p>האימייל, הטלפון והכתובת מוצפנים לפני הבדיקה. בעלי חנויות יכולים לראות רק שנמצאה התאמה בהזמנה שלהם.</p><ul><li><Shield size={15} /> {reports.length} התאמות פעילות בחנויות שלך</li><li><LockKeyhole size={15} /> פרטי החנות המדווחת לא נחשפים</li><li><FileClock size={15} /> כל בדיקה נשמרת ביומן פעילות</li></ul></div></div>
    <section className="case-section"><div className="section-heading"><div><h2>אנשים ברשימת החסימה</h2><span>{groups.length} אירועים · {activeReports.length} מזהים מוצפנים במאגר המשותף</span></div></div>{groups.map((group) => { const first = group[0]; const source = cases.find((item) => item.id === first.caseId); const visible = (report: BlacklistReport) => {
      if (!source) return report.maskedValue;
      const values = { email: isRealEmail(source.email) ? source.email : "", phone: source.context?.phone, address: source.context?.address, ip: source.context?.ip, customer: source.context?.customerId };
      return values[report.keyType] || report.maskedValue;
    }; return <div className="report-row block-group" key={first.caseId}><div className="report-icon"><Fingerprint /></div><div><strong>{source ? `${customerDisplayName(source)} · הזמנה ${source.orderNumber}` : first.reason}</strong><div className="identity-chips">{group.map((report) => <span key={report.id}>{identityLabel[report.keyType]} · {visible(report)}</span>)}</div></div><SeverityBadge severity="critical" /><span>ברשימת חסימה</span><button className="secondary-button" disabled={releasing === first.caseId} onClick={() => void release(first.caseId)}>{releasing === first.caseId ? "משחרר…" : "שחרר חסימה"}</button></div>; })}{groups.length === 0 ? <div className="empty-state"><Fingerprint size={25} /><strong>אין עדיין חסימות</strong><span>אימייל, טלפון, כתובת, IP ומזהה Shopify יתווספו רק לאחר אישור הונאה.</span></div> : null}</section>
  </div>;
}

function TeamScreen() {
  return <div className="page-content product-page team-page"><PageHeading eyebrow="גישה והרשאות" title="מי יכול לראות ולטפל בהתראות?" description="כל משתמש יקבל גישה רק לחנויות של הארגון שלו ובהתאם לתפקיד שיוגדר לו." /><section className="compact-overview"><div><span>משתמשים פעילים</span><strong>0</strong><small>לא נוספו משתמשים</small></div><div><span>הזמנות ממתינות</span><strong>0</strong><small>אין הזמנות פתוחות</small></div><div><span>אימות דו־שלבי</span><strong>—</strong><small>יוגדר בעת הצטרפות</small></div></section><section className="case-section"><div className="section-heading"><div><h2>חברי הצוות</h2><span>משתמשים אמיתיים בלבד</span></div></div><div className="empty-state"><UserRoundCog size={25} /><strong>עדיין לא הוזמנו משתמשים</strong><span>לא מוצגים כאן חשבונות לדוגמה. משתמש חדש יופיע לאחר שליחת הזמנה.</span></div></section></div>;
}

function PlatformScreen() {
  return <div className="page-content product-page platform-page"><PageHeading eyebrow="לבעל הפלטפורמה בלבד" title="ניהול הפלטפורמה" description="כאן אתה מנהל לקוחות וחיבורי Shopify. כל לקוח נכנס לסביבה נפרדת ורואה רק את החנויות שלו." />
    <section className="metric-grid"><Metric icon={<Building2 />} label="לקוחות פעילים" value="0" detail="אין עדיין לקוחות" /><Metric icon={<Activity />} label="עסקאות שנסרקו היום" value="0" detail="יתעדכן לאחר חיבור חנות" tone="success" /><Metric icon={<ShieldAlert />} label="תיקים קריטיים פתוחים" value="0" detail="אין נתונים" tone="critical" /><Metric icon={<RefreshCcw />} label="חיבורים שדורשים טיפול" value="0" detail="אין חיבורים" tone="warning" /></section>
    <section className="case-section"><div className="section-heading"><div><h2>לקוחות וחיבורי Shopify</h2><span>מידע של לקוח אחד לעולם לא מוצג ללקוח אחר</span></div></div><div className="empty-state"><Building2 size={25} /><strong>אין עדיין לקוחות בפלטפורמה</strong><span>הלקוח הראשון יופיע כאן רק לאחר שתפתח עבורו גישה ותחבר חנות אמיתית.</span></div></section>
  </div>;
}
