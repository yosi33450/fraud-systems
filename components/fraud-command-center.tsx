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
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { SeverityBadge } from "@/components/severity-badge";
import { cases as initialCases, employees, rules, stores } from "@/lib/initial-state";
import type { BlacklistReport, CaseStatus, DashboardSnapshot, Employee, FraudCase, NotificationDelivery, NotificationSettings, RiskCondition, RiskConditionField, RiskRule, Severity, Store } from "@/lib/types";

type View = "overview" | "cases" | "stores" | "employees" | "rules" | "notifications" | "network" | "team" | "platform";
type RuleReconciliation = { reviewed: number; updated: number; resolved: number; reopened: number; active: number };

const nav = [
  { id: "overview", label: "מרכז בקרה", Icon: LayoutDashboard },
  { id: "cases", label: "התראות וחקירות", Icon: ClipboardList, count: 8 },
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
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);
  const [caseData, setCaseData] = useState(initialCases);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [store, setStore] = useState("all");
  const [ruleData, setRuleData] = useState(rules);
  const [storeData, setStoreData] = useState<Store[]>(stores);
  const [employeeData, setEmployeeData] = useState<Employee[]>(employees);
  const [reports, setReports] = useState<BlacklistReport[]>([]);
  const [notifications, setNotifications] = useState<NotificationSettings>({ tenantId, enabled: false, recipients: [], severities: ["critical", "high"], reminderMinutes: 30 });
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [syncState, setSyncState] = useState<"loading" | "live" | "error">("loading");
  const [mobileNav, setMobileNav] = useState(false);
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
    setStoreData(snapshot.stores);
    setEmployeeData(snapshot.employees);
    setRuleData(snapshot.rules);
    setReports(snapshot.reports);
    setNotifications(snapshot.notifications);
    setDeliveries(snapshot.deliveries);
    setSyncState("live");
  };

  const refreshSnapshot = async () => {
    setSyncState("loading");
    try {
      const response = await fetch(`/api/tenants/${tenantId}/snapshot`, { cache: "no-store" });
      if (!response.ok) throw new Error("SNAPSHOT_FAILED");
      applySnapshot(await response.json() as DashboardSnapshot);
    } catch {
      setSyncState("error");
    }
  };

  useEffect(() => { void refreshSnapshot(); }, []);

  const decideCase = async (status: CaseStatus) => {
    if (!selectedCase) return;
    const previous = selectedCase;
    setCaseData((current) => current.map((item) => item.id === selectedCase.id ? { ...item, status } : item));
    setSelectedCase((current) => current ? { ...current, status } : current);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/cases/${selectedCase.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("CASE_UPDATE_FAILED");
      const payload = await response.json() as { case: FraudCase };
      setCaseData((current) => current.map((item) => item.id === payload.case.id ? payload.case : item));
      setSelectedCase(payload.case);
      if (status === "fraud") void refreshSnapshot();
    } catch {
      setCaseData((current) => current.map((item) => item.id === previous.id ? previous : item));
      setSelectedCase(previous);
      setSyncState("error");
    }
  };

  const openCase = (item: FraudCase) => {
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

  const createEmployee = async (input: Pick<Employee, "name" | "email" | "department">) => {
    const response = await fetch(`/api/tenants/${tenantId}/employees`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("EMPLOYEE_CREATE_FAILED");
    const payload = await response.json() as { employee: Employee };
    setEmployeeData((current) => [payload.employee, ...current]);
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
    const payload = await response.json() as { rule: RiskRule };
    setRuleData((current) => [payload.rule, ...current]);
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
    try {
      const response = await fetch(`/api/tenants/${tenantId}/stores/${storeId}/sync`, { method: "POST" });
      if (!response.ok) throw new Error("SHOPIFY_SYNC_FAILED");
      await refreshSnapshot();
    } catch {
      setSyncState("error");
    }
  };

  const releaseBlock = async (caseId: string) => {
    const response = await fetch(`/api/tenants/${tenantId}/cases/${caseId}/block`, { method: "DELETE" });
    if (!response.ok) throw new Error("BLOCK_RELEASE_FAILED");
    await refreshSnapshot();
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">דלג לתוכן הראשי</a>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="ניווט ראשי">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Shield size={21} /></div>
          <div><strong>Shield Ledger</strong><span>מרכז מניעת הונאות</span></div>
          <button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="סגירת תפריט"><X size={18} /></button>
        </div>
        <button className="tenant-switcher">
          <span className="tenant-avatar"><Shield size={16} /></span>
          <span><strong>הארגון שלי</strong><small>{storeData.length ? `${storeData.length} חנויות מחוברות` : "טרם חוברה חנות"}</small></span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <nav className="nav-list">
          {nav.map(({ id, label, Icon, count }) => (
            <button key={id} className={view === id ? "nav-active" : ""} onClick={() => { setView(id); setMobileNav(false); }}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
              {count && (id !== "cases" || caseData.some((item) => !["resolved", "false-positive"].includes(item.status))) ? <small>{id === "cases" ? caseData.filter((item) => !["resolved", "false-positive"].includes(item.status)).length : count}</small> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setView("platform")}><Gauge size={18} /><span>ניהול הפלטפורמה</span><span className="owner-chip">בעלים</span></button>
          <button onClick={() => setView("notifications")}><Settings size={18} /><span>הגדרות התראות</span></button>
          <div className="user-block"><div className="user-avatar"><CircleUserRound size={17} /></div><div><strong>חשבון בעלים</strong><span>בעל הפלטפורמה</span></div><ChevronLeft size={15} /></div>
        </div>
      </aside>

      <main className="main-content" id="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="פתיחת תפריט"><Menu size={20} /></button>
          <div className={`topbar-context sync-${syncState} ${realtimeNeedsSetup && storeData.length ? "sync-warning" : ""}`}><span className="live-dot" />{syncState === "error" ? "בעיית סנכרון — הנתונים האחרונים נשמרו" : syncState === "loading" ? "מסנכרן נתונים…" : realtimeActive ? "אירועים חדשים נקלטים בזמן אמת" : realtimeRegistered ? "קליטה בזמן אמת הוגדרה — ממתין להזמנה חדשה" : storeData.length ? "נדרש חיבור מחדש לקליטה בזמן אמת" : "ממתין לחיבור חנות"}<span>·</span> API מאובטח לפי לקוח</div>
          <div className="topbar-actions">
            <button className="store-pill"><StoreIcon size={15} /> {storeData.length ? "כל החנויות" : "אין חנות מחוברת"} <ChevronDown size={14} /></button>
            <button className="icon-button notification-button" onClick={() => setView("notifications")} aria-label="הגדרות התראות"><Bell size={19} /><span /></button>
          </div>
        </header>

        {view === "overview" || view === "cases" ? (
          <Overview
            cases={visibleCases}
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
        {view === "stores" ? <StoresScreen stores={storeData} onConnect={() => setConnectOpen(true)} onSync={syncShopifyStore} syncing={syncState === "loading"} /> : null}
        {view === "employees" ? <EmployeesScreen employees={employeeData} onCreate={createEmployee} /> : null}
        {view === "rules" ? <RulesScreen rules={ruleData} onToggle={toggleRule} onSave={saveRule} onCreate={createRule} /> : null}
        {view === "notifications" ? <NotificationsScreen settings={notifications} deliveries={deliveries} onSave={saveNotifications} /> : null}
        {view === "network" ? <NetworkScreen reports={reports} onRelease={releaseBlock} /> : null}
        {view === "team" ? <TeamScreen /> : null}
        {view === "platform" ? <PlatformScreen /> : null}
      </main>

      {selectedCase ? <InvestigationDrawer item={selectedCase} onClose={() => setSelectedCase(null)} onDecide={decideCase} /> : null}
      {connectOpen ? <ConnectStoreDialog onClose={() => setConnectOpen(false)} onConnect={connectShopifyStore} /> : null}
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
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
  severity: Severity;
};

const severityOrder: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const isRealEmail = (value: string) => value.includes("@") && !value.startsWith("לא זמין");

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
    ].filter(Boolean);
    identities.forEach((identity) => {
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
      giftCardOrders: cases.filter((item) => item.items.some((line) => /gift\s*card|כרטיס\s*מתנה/i.test(line.name))).length,
    };
  }).sort((left, right) => severityOrder[right.severity] - severityOrder[left.severity] || right.cases.length - left.cases.length);
}

function Overview({ cases, query, setQuery, severity, setSeverity, store, setStore, stores, onOpen, casesOnly, onRefresh, refreshing, deliveries, onShowAll, onOpenNotifications, onOpenStores }: {
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
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const activeCases = cases.filter((item) => ["new", "review", "action"].includes(item.status));
  const displayCases = casesOnly && showClosed ? cases : activeCases;
  const clusters = useMemo(() => clusterCases(displayCases), [displayCases]);
  const toggleCluster = (id: string) => setExpandedClusters((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="page-content">
    <PageHeading eyebrow={casesOnly ? "תור החלטות" : "מרכז החלטות"} title={casesOnly ? "התראות וחקירות" : hasStores ? "מה דורש טיפול עכשיו" : "חבר את חנות Shopify הראשונה"} description={casesOnly ? "כל הזמנה חשודה נשארת כאן עד שבעל החנות מקבל החלטה." : hasStores ? `יש ${cases.filter((item) => ["new", "review", "action"].includes(item.status)).length} תיקים פתוחים. המערכת מתריעה — ההחלטה תמיד נשארת אצלך.` : "לא נטען מידע לדוגמה. לאחר החיבור יוצגו כאן רק הזמנות ונתונים אמיתיים מהחנות שלך."} action={hasStores ? <button className="secondary-button" onClick={() => void onRefresh()} disabled={refreshing}><RefreshCcw size={15} className={refreshing ? "spin" : ""} /> {refreshing ? "מסנכרן…" : "רענון נתונים"}</button> : <button className="primary-button" onClick={onOpenStores}><Plus size={16} /> חיבור חנות</button>} />

    {!casesOnly && !hasStores ? <section className="connection-empty"><div className="connection-empty-icon"><StoreIcon size={28} /></div><div><span className="eyebrow">מתחילים מנתונים אמיתיים</span><h2>סביבת העבודה נקייה ומוכנה לחיבור</h2><p>לא יופיעו עסקאות, עובדים, התראות או נתוני לקוחות עד שחנות Shopify אמיתית תחובר.</p></div><ol><li><strong>1</strong><span>מחברים חנות ומאשרים גישה להזמנות</span></li><li><strong>2</strong><span>בוחרים חוקי סיכון ונמעני אימייל</span></li><li><strong>3</strong><span>הזמנות חדשות נבדקות בזמן אמת</span></li></ol><button className="primary-button" onClick={onOpenStores}>עבור לחיבור חנות <ChevronLeft size={15} /></button></section> : null}

    {!casesOnly && hasStores ? <>
      <section className="metric-grid" aria-label="מדדי סיכון">
        <Metric icon={<ShieldAlert />} label="ממתינים להחלטה" value={String(cases.filter((item) => ["new", "review", "action"].includes(item.status)).length)} detail={`${cases.filter((item) => item.severity === "critical" && ["new", "review", "action"].includes(item.status)).length} דורשים טיפול מיידי`} tone="critical" />
        <Metric icon={<Fingerprint />} label="סכום בהזמנות חשודות" value={formatCurrency(cases.filter((item) => ["new", "review", "action"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0))} detail="בתיקים שעדיין פתוחים" />
        <Metric icon={<Mail />} label="התראות לבעלי החנות" value={String(deliveries.filter((item) => ["sent", "simulated"].includes(item.status)).length)} detail="נשלחו באימייל" tone="warning" />
        <Metric icon={<CheckCircle2 />} label="נסגרו אוטומטית" value={String(automaticallyClosed)} detail={`${merchantDecisions} נסגרו בהחלטת בעל החנות`} tone="success" />
      </section>
      <section className="signal-row">
        <div className="signal-card"><div className="signal-kicker"><Mail size={16} /> התראות לבעלים</div><strong>התראה נשלחת מיד על סיכון גבוה או קריטי</strong><p>בעל החנות מקבל אימייל עם ההזמנה והסיבה, ואז מסמן בבדיקה, טופל, תקין או הונאה.</p><button onClick={onOpenNotifications}>הגדר נמענים <ChevronLeft size={14} /></button></div>
        <div className="signal-card employee-signal"><div className="signal-kicker"><UsersRound size={16} /> ניטור עובדים</div><strong>{cases.some((item) => item.evidence.some((evidence) => evidence.source === "employee")) ? "נמצאו מקרים הקשורים לעובדים" : "לא נמצאו מקרים הקשורים לעובדים"}</strong><p>מקרים יוצגו רק לאחר הוספת כתובות עובדים וזיהוי התאמה להזמנה אמיתית.</p><button onClick={() => onShowAll()}>לכל התיקים <ChevronLeft size={14} /></button></div>
        <div className="mini-chart-card"><div><span>התראות פתוחות</span><strong>{cases.filter((item) => ["new", "review", "action"].includes(item.status)).length}</strong></div><div className="empty-mini-chart">התרשים יתמלא עם קבלת הזמנות</div></div>
      </section>
    </> : null}

    <section className="case-section">
      <div className="section-heading"><div><h2>{casesOnly ? "התראות לפי זהות" : "תור החלטות"}</h2><span>{clusters.length} קבוצות · {displayCases.length} הזמנות</span></div>{casesOnly ? <button className="secondary-button" onClick={() => setShowClosed((value) => !value)}>{showClosed ? "הצג פעילות בלבד" : `הצג גם ${cases.length - activeCases.length} שטופלו`}</button> : <button className="text-button" onClick={onShowAll}>הצג הכל <ChevronLeft size={14} /></button>}</div>
      <div className="filter-bar">
        <label className="search-box"><Search size={16} /><span className="sr-only">חיפוש</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש הזמנה, לקוח או סיבה" /></label>
        <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity | "all")} aria-label="סינון לפי חומרה"><option value="all">כל החומרות</option><option value="critical">קריטי</option><option value="high">גבוה</option><option value="medium">בינוני</option><option value="low">נמוך</option></select>
        <select value={store} onChange={(event) => setStore(event.target.value)} aria-label="סינון לפי חנות"><option value="all">כל החנויות</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button className="filter-button"><Filter size={15} /> מסננים נוספים</button>
      </div>
      <div className="case-cluster-list">
        {clusters.map((cluster) => {
          const expanded = expandedClusters.has(cluster.id);
          const activeClusterCases = cluster.cases.filter((item) => ["new", "review", "action"].includes(item.status));
          const closedByRules = activeClusterCases.length === 0 && cluster.cases.every(isAutomaticallyResolved);
          const activeSeverity = activeClusterCases.reduce<Severity>((highest, item) => severityOrder[item.severity] > severityOrder[highest] ? item.severity : highest, "low");
          const statusCase = activeClusterCases.find((item) => item.status === "action") ?? activeClusterCases.find((item) => item.status === "review") ?? activeClusterCases[0] ?? cluster.cases[0];
          const repeatedBy = cluster.cases.length > 1
            ? cluster.emails.length === 1 ? `אותו אימייל · ${cluster.emails[0]}`
              : cluster.ips.length === 1 ? `אותה כתובת IP · ${cluster.ips[0]}`
                : cluster.phones.length === 1 ? `אותו טלפון · ${cluster.phones[0]}`
                  : "זהויות מקושרות"
            : customerDisplayName(cluster.cases[0]);
          return <article className={`case-cluster ${cluster.cases.length > 1 ? "case-cluster-linked" : ""}`} key={cluster.id}>
            <button className="case-cluster-summary" onClick={() => cluster.cases.length === 1 ? onOpen(cluster.cases[0]) : toggleCluster(cluster.id)} aria-expanded={cluster.cases.length > 1 ? expanded : undefined}>
              <div className="cluster-severity">{closedByRules ? <span className="closed-by-rules"><CheckCircle2 size={15} /> נסגר לפי החוקים</span> : <SeverityBadge severity={activeClusterCases.length ? activeSeverity : cluster.severity} score={Math.max(...(activeClusterCases.length ? activeClusterCases : cluster.cases).map((item) => item.score))} />}</div>
              <div className="cluster-identity"><strong>{repeatedBy}</strong><span>{cluster.cases.length > 1 ? `${cluster.cases.length} הזמנות קושרו לאותה זהות` : `${cluster.cases[0].orderNumber} · ${cluster.cases[0].reason}`}</span><div className="cluster-signals">{cluster.emails.length > 1 ? <span><Mail size={13} /> {cluster.emails.length} אימיילים</span> : null}{cluster.ips.length === 1 && cluster.cases.length > 1 ? <span><Wifi size={13} /> IP משותף</span> : null}{cluster.phones.length === 1 && cluster.cases.length > 1 ? <span><Phone size={13} /> טלפון משותף</span> : null}{cluster.giftCardOrders > 0 ? <span><Gift size={13} /> {cluster.giftCardOrders} Gift Card</span> : null}</div></div>
              <div className="cluster-stat"><span>הזמנות</span><strong>{cluster.cases.length}</strong></div>
              <div className="cluster-stat"><span>סכום כולל</span><strong>{formatCurrency(cluster.totalAmount)}</strong></div>
              <div className="cluster-status"><span className={`status status-${statusCase.status}`}>{closedByRules ? "נסגר אוטומטית" : caseStatusLabel(statusCase)}</span>{cluster.cases.length > 1 ? expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} /> : <ChevronLeft size={18} />}</div>
            </button>
            {expanded ? <div className="cluster-orders">{cluster.cases.map((item) => <button key={item.id} className="cluster-order" onClick={() => onOpen(item)}><span className="cluster-order-index mono">{item.orderNumber}</span><span><strong>{customerDisplayName(item)}</strong><small>{isPayPlusPlaceholder(item) ? "PayPlus · פרטי קשר לא התקבלו" : item.email}</small></span><span className="reason-cell">{isAutomaticallyResolved(item) ? item.resolution?.note ?? "לא עומד עוד בחוקי הסיכון הפעילים" : item.reason}</span><strong className="mono amount-cell">{formatCurrency(item.amount)}</strong><span className={`status status-${item.status}`}>{caseStatusLabel(item)}</span><ChevronLeft size={16} /></button>)}</div> : null}
          </article>;
        })}
        {displayCases.length === 0 ? <div className="empty-state"><Shield size={26} /><strong>{hasStores ? "אין כרגע התראות פעילות" : "אין נתונים להצגה"}</strong><span>{hasStores ? "שינויי החוקים חושבו מחדש. הזמנות חשודות חדשות יופיעו כאן." : "חבר חנות Shopify כדי להתחיל לקבל ולבדוק הזמנות."}</span></div> : null}
      </div>
    </section>
  </div>;
}

function Metric({ icon, label, value, detail, tone = "default" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function InvestigationDrawer({ item, onClose, onDecide }: { item: FraudCase; onClose: () => void; onDecide: (status: CaseStatus) => void }) {
  const closedByRules = isAutomaticallyResolved(item);
  const missingBuyerIdentity = isPayPlusPlaceholder(item) || ["ללא שם", "לקוח Shopify", ""].includes(item.customer.trim());
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="investigation-drawer" role="dialog" aria-modal="true" aria-label={`חקירת הזמנה ${item.orderNumber}`}>
      <header className="drawer-header"><div><span className="eyebrow">INVESTIGATION CASE</span><div className="drawer-title"><h2>{item.orderNumber}</h2>{closedByRules ? <span className="closed-by-rules"><CheckCircle2 size={15} /> נסגר לפי החוקים</span> : <SeverityBadge severity={item.severity} score={item.score} />}</div><p>{item.storeName} · נפתח {item.createdAt}</p></div><button className="icon-button" onClick={onClose} aria-label="סגירת תיק"><X size={20} /></button></header>
      <div className="drawer-body">
        <section className={`score-hero ${closedByRules ? "score-hero-resolved" : ""}`}>{closedByRules ? <div className="resolved-mark"><CheckCircle2 size={28} /></div> : <div className="score-ring"><strong>{item.score}</strong><span>/100</span></div>}<div><span>{closedByRules ? "נסגר אוטומטית בחישוב חוקים" : "רמת חשד"}</span><h3>{closedByRules ? "ההתראה אינה פעילה" : item.reason}</h3><p>{closedByRules ? item.resolution?.note ?? "ההזמנה אינה עומדת כרגע באף חוק סיכון פעיל. לא התקבלה החלטה אנושית לגביה." : `${item.evidence.length} תנאים זוהו בהזמנה. המערכת מתריעה בלבד — בעל החנות מקבל את ההחלטה.`}</p></div></section>
        <div className="drawer-grid">
          <section><div className="section-heading"><div><h3>למה התקבלה ההתראה?</h3><span>כל תנאי מוצג בשפה ברורה לבדיקה</span></div></div><div className="evidence-ledger">{item.evidence.map((evidence) => <article key={evidence.id} className="evidence-node"><div className={`evidence-dot source-${evidence.source}`} /><div className="evidence-time mono">{evidence.timestamp}</div><div className="evidence-card"><div><span>{sourceLabels[evidence.source]}</span><strong className="condition-met">תנאי התקיים</strong></div><h4>{evidence.label}</h4><p>{evidence.description}</p></div></article>)}</div></section>
          <section className="order-context"><h3>זהות והקשר להזמנה</h3><p className="context-note">הפרטים עוזרים לחבר בין עסקאות. כתובת IP לבדה אינה מזהה אדם בוודאות.</p>{missingBuyerIdentity ? <div className="identity-data-notice"><Info size={18} /><div><strong>{isPayPlusPlaceholder(item) ? "PayPlus העבירה ל-Shopify לקוח טכני, לא את זהות הקונה" : "Shopify לא החזירה שם לקוח להזמנה"}</strong><span>{item.context?.phone ? "קיים מספר טלפון ולכן אפשר לזהות ולקשר לפי הטלפון." : "לא התקבלו מספיק פרטי קשר כדי לזהות את האדם או לקשר אותו להזמנות אחרות."}</span></div></div> : null}<div className="identity-grid"><div><span><Wifi size={15} /> כתובת IP</span><strong className="mono">{item.context?.ip || "לא התקבלה מ־Shopify"}</strong></div><div><span><CreditCard size={15} /> אמצעי תשלום</span><strong>{item.context?.paymentGateways.join(", ") || "לא התקבל"}</strong></div><div><span><MapPin size={15} /> כתובת משלוח</span><strong>{item.context?.address || "לא התקבלה מ־Shopify"}</strong></div><div><span><Phone size={15} /> טלפון</span><strong className="mono">{item.context?.phone || "לא התקבל מ־Shopify"}</strong></div></div>{item.context?.ip ? <p className="context-note">ב־2 השעות האחרונות זוהו מה־IP הזה <strong>{item.context.ipOrderCountLastTwoHours ?? 1} הזמנות</strong>, מתוכן <strong>{item.context.ipGiftCardOrderCountLastTwoHours ?? 0} רכישות Gift Card</strong>, באמצעות <strong>{item.context.ipDistinctEmailsLastTwoHours ?? 1} אימיילים שונים</strong>.</p> : null}{item.context?.riskFacts.length ? <div className="shopify-risk-facts"><strong>אותות סיכון מ־Shopify</strong><ul>{item.context.riskFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div> : null}<h3>פרטי ההזמנה</h3><dl><div><dt>לקוח</dt><dd>{customerDisplayName(item)}</dd></div><div><dt>אימייל</dt><dd className="mono">{isRealEmail(item.email) ? item.email : "לא התקבל מ־Shopify"}</dd></div><div><dt>סכום</dt><dd className="mono">{formatCurrency(item.amount)}</dd></div><div><dt>חנות</dt><dd>{item.storeName}</dd></div></dl><h4>פריטים</h4><ul>{item.items.map((product) => <li key={product.name}><span>{product.quantity}× {product.name}</span><strong className="mono">{formatCurrency(product.quantity * product.price)}</strong></li>)}</ul><button className="secondary-button full-button">פתח ב-Shopify <ExternalLink size={14} /></button></section>
        </div>
      </div>
      <footer className="decision-bar"><div><span>סטטוס נוכחי</span><strong>{closedByRules ? "נסגר לפי החוקים" : caseStatusLabel(item)}</strong></div>{closedByRules ? <span className="decision-explanation">שינוי בחוקים שיחזיר התאמה יפתח את ההתראה מחדש אוטומטית.</span> : <div className="decision-actions">{item.status === "new" ? <button className="secondary-button" onClick={() => onDecide("review")}>העבר לבדיקה</button> : null}<button className="secondary-button" onClick={() => onDecide("false-positive")}>לא חשוד</button><button className="secondary-button" onClick={() => onDecide("resolved")}><CheckCircle2 size={16} /> סגור כטופל</button><button className="danger-button" onClick={() => onDecide("fraud")}><ShieldAlert size={16} /> אשר הונאה והוסף לחסימה</button></div>}</footer>
    </aside>
  </div>;
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
  return <div className="drawer-backdrop connect-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !connecting) onClose(); }}>
    <section className="connect-dialog" role="dialog" aria-modal="true" aria-label="חיבור חנות Shopify">
      <header><div className="connect-brand"><div><StoreIcon size={21} /></div><span>Shopify</span></div><button className="icon-button" onClick={onClose} disabled={connecting} aria-label="סגירת חלון החיבור"><X size={19} /></button></header>
      <div className="connect-copy"><span className="eyebrow">חיבור ישיר ומאובטח</span><h2>חיבור חנות Shopify</h2><p>מתאים לבדיקת חנות ששייכת לארגון Shopify שלך. המערכת מחליפה את פרטי האפליקציה ב־Access Token ובודקת את זהות החנות.</p></div>
      <form onSubmit={submit} className="connect-form" autoComplete="off">
        <label className="field-label">כתובת החנות<span>הדומיין הקבוע של החנות, לא כתובת האתר הציבורית.</span><div className="domain-input"><span aria-hidden="true">https://</span><input name="shopDomain" dir="ltr" required placeholder="your-store.myshopify.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" aria-label="דומיין קבוע של חנות Shopify" /></div></label>
        <div className="credentials-grid"><label className="field-label">Client ID<input name="clientId" dir="ltr" required autoComplete="off" placeholder="מ־Shopify Dev Dashboard" /></label><label className="field-label">Client secret<input name="clientSecret" dir="ltr" type="password" required autoComplete="new-password" placeholder="••••••••••••••••" /></label></div>
        <div className="credential-note"><LockKeyhole size={17} /><div><strong>ה־Client secret לא נשמר בדפדפן</strong><span>הוא נשלח לשרת המקומי רק כדי לקבל Token זמני מ־Shopify. לחנויות של לקוחות חיצוניים נוסיף בהמשך התקנת OAuth.</span></div></div>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        <div className="connect-help"><span>את הפרטים מוצאים ב־Dev Dashboard ← Apps ← האפליקציה שלך ← Settings.</span><a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer">פתח Dev Dashboard <ExternalLink size={13} /></a></div>
        <footer><button type="button" className="secondary-button" onClick={onClose} disabled={connecting}>ביטול</button><button className="primary-button" disabled={connecting}>{connecting ? <><RefreshCcw size={15} className="spin" /> בודק מול Shopify…</> : <><Shield size={15} /> בדוק וחבר חנות</>}</button></footer>
      </form>
    </section>
  </div>;
}

function StoresScreen({ stores, onConnect, onSync, syncing }: { stores: Store[]; onConnect: () => void; onSync: (storeId: string) => Promise<void>; syncing: boolean }) {
  const connected = stores.filter((store) => ["active", "registered"].includes(store.realtimeStatus ?? "")).length;
  const ordersToday = stores.reduce((total, store) => total + store.ordersLast30Days, 0);
  return <div className="page-content"><PageHeading eyebrow="חיבורי SHOPIFY" title="החנויות שמוגנות כרגע" description="לכל חנות סביבת עבודה נפרדת. כאן אפשר לראות אם הנתונים נקלטים ומתי התקבלה ההזמנה האחרונה." action={<button className="primary-button" onClick={onConnect}><Plus size={16} /> חיבור חנות</button>} />
    <section className="compact-overview"><div><span>חנויות מחוברות</span><strong>{connected} מתוך {stores.length}</strong><small>מקבלות הזמנות בזמן אמת</small></div><div><span>הזמנות ב־30 יום</span><strong>{ordersToday.toLocaleString("he-IL")}</strong><small>מכל החנויות בארגון</small></div><div><span>דורש טיפול</span><strong>{stores.length - connected}</strong><small>חיבורים שצריך לבדוק</small></div></section>
    {stores.length ? <div className="store-grid">{stores.map((item) => { const receiving = item.realtimeStatus === "active"; const registered = item.realtimeStatus === "registered"; const realtimeReady = receiving || registered; const configuring = item.realtimeStatus === "configuring"; return <article className="store-card" key={item.id}><div className="store-card-top"><div className="store-logo"><StoreIcon /></div><span className={`connection-state ${realtimeReady ? "state-active" : "state-degraded"}`}>{receiving ? "אירועים נקלטים בזמן אמת" : registered ? "קליטה חיה הוגדרה · ממתין להזמנה" : configuring ? "מגדיר קליטה בזמן אמת" : "נדרש חיבור מחדש לזמן אמת"}</span></div><h2>{item.name}</h2><p className="mono">{item.domain}</p>{!realtimeReady ? <div className="realtime-notice"><Info size={16} /><div><strong>סנכרון 30 הימים הושלם, אך קליטה חיה עדיין לא הוגדרה</strong><span>יש לבצע חיבור מחדש פעם אחת כדי לרשום את ההתראה האוטומטית מול Shopify.</span></div></div> : null}<div className="store-stats"><div><span>הזמנות ב־30 יום</span><strong>{item.ordersLast30Days.toLocaleString("he-IL")}</strong></div><div><span>הזמנה אחרונה שנשמרה</span><strong>{item.lastEventAt}</strong></div><div><span>אירוע חי אחרון</span><strong>{item.lastWebhookAt ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.lastWebhookAt)) : registered ? "ממתין להזמנה חדשה" : "עדיין לא התקבל"}</strong></div><div><span>סנכרון היסטורי אחרון</span><strong>{item.lastSyncAt ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.lastSyncAt)) : "לא בוצע"}</strong></div></div><div className="store-actions"><button onClick={() => void onSync(item.id)} disabled={syncing}>{syncing ? "מסנכרן…" : "סנכרן 30 יום מחדש"}</button><button className={!realtimeReady ? "reconnect-attention" : ""} onClick={onConnect} aria-label={`חיבור מחדש של ${item.name}`}><RefreshCcw size={15} /> חיבור מחדש</button></div></article>; })}</div> : <div className="empty-panel"><div className="empty-panel-icon"><StoreIcon size={25} /></div><h2>עדיין לא חוברה חנות</h2><p>לא הוזנו פרטי חנות לדוגמה. החנות הראשונה שתחבר תופיע כאן עם נתונים אמיתיים בלבד.</p><button className="primary-button" onClick={onConnect}><Plus size={16} /> חיבור חנות Shopify</button></div>}
    <div className="security-note"><LockKeyhole size={20} /><div><strong>כל חנות רואה רק את המידע שלה</strong><p>פרטי החיבור נשמרים מוצפנים. רק בעל הפלטפורמה יכול לחבר חנות או להחליף הרשאות.</p></div></div>
  </div>;
}

function EmployeesScreen({ employees, onCreate }: { employees: Employee[]; onCreate: (input: Pick<Employee, "name" | "email" | "department">) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      await onCreate({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), department: String(form.get("department") ?? "") });
      setAdding(false);
    } catch { setError("לא ניתן להוסיף את העובד. ייתכן שהאימייל כבר קיים."); }
    finally { setSaving(false); }
  };
  const refundsToReview = employees.reduce((total, employee) => total + employee.refunded, 0);
  const highRiskEmployees = employees.filter((employee) => employee.risk === "critical" || employee.risk === "high").length;
  return <div className="page-content"><PageHeading eyebrow="בדיקה פנימית" title="רכישות וזיכויים של עובדים" description="המערכת משווה את כתובות העובדים להזמנות ומציפה רק מקרים שדורשים בדיקה — בלי לקבוע מראש שנעשתה הונאה." action={<button className="primary-button" onClick={() => setAdding((value) => !value)}><Plus size={16} /> הוספת עובד לניטור</button>} />
    <section className="compact-overview"><div><span>עובדים בניטור</span><strong>{employees.length}</strong><small>לפי אימייל ארגוני</small></div><div><span>זיכויים שנמצאו</span><strong>{refundsToReview}</strong><small>ממתינים לבדיקה אנושית</small></div><div><span>סיכון גבוה</span><strong>{highRiskEmployees}</strong><small>עובדים עם דפוס חריג</small></div></section>
    {adding ? <form className="employee-form" onSubmit={submit}><label>שם מלא<input name="name" required placeholder="שם העובד" /></label><label>אימייל<input name="email" required type="email" dir="ltr" placeholder="employee@company.co.il" /></label><label>מחלקה<input name="department" required placeholder="למשל שירות לקוחות" /></label><button className="primary-button" disabled={saving}>{saving ? "שומר…" : "הוסף לניטור"}</button>{error ? <p role="alert">{error}</p> : null}</form> : null}
    <section className="case-section"><div className="section-heading"><div><h2>עובדים שנבדקים אוטומטית</h2><span>לחיצה על עובד תציג את ההזמנות והזיכויים שנמצאו</span></div><button className="secondary-button">ייבוא רשימה</button></div><div className="table-wrap"><table className="case-table"><thead><tr><th>עובד</th><th>מחלקה</th><th>רכישות שנמצאו</th><th>זיכויים שנמצאו</th><th>מצב לבדיקה</th><th /></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.name}</strong><small>{employee.email}</small></td><td>{employee.department}</td><td className="mono">{employee.purchases}</td><td className="mono">{employee.refunded}</td><td><SeverityBadge severity={employee.risk} /></td><td><ChevronLeft size={16} /></td></tr>)}</tbody></table>{employees.length === 0 ? <div className="empty-state"><UsersRound size={25} /><strong>לא נוספו עובדים לניטור</strong><span>אפשר להוסיף עובד ידנית או לייבא רשימה לאחר חיבור החנות.</span></div> : null}</div></section>
  </div>;
}

const conditionFields: { value: RiskConditionField; label: string; boolean?: boolean; suffix?: string }[] = [
  { value: "orders_by_email", label: "מספר הזמנות מאותו אימייל", suffix: "הזמנות" },
  { value: "orders_by_ip", label: "מספר הזמנות מאותה כתובת IP", suffix: "הזמנות" },
  { value: "gift_card_orders_by_ip", label: "רכישות Gift Card מאותה כתובת IP", suffix: "הזמנות" },
  { value: "emails_by_ip", label: "מספר אימיילים שונים מאותה כתובת IP", suffix: "אימיילים" },
  { value: "identities_by_phone", label: "מספר אימיילים לאותו טלפון", suffix: "זהויות" },
  { value: "order_amount", label: "סכום ההזמנה", suffix: "₪" },
  { value: "order_amount_vs_average", label: "סכום ביחס לממוצע החנות", suffix: "פי הממוצע" },
  { value: "gift_card_value", label: "שווי Gift Cards", suffix: "₪" },
  { value: "payment_failures", label: "ניסיונות תשלום כושלים", suffix: "ניסיונות" },
  { value: "network_match", label: "התאמה למאגר המשותף", boolean: true },
  { value: "employee_match", label: "הלקוח מופיע ברשימת העובדים", boolean: true },
  { value: "refund_after_fulfillment", label: "זיכוי לאחר מסירת הסחורה", boolean: true },
];

const conditionSentence = (condition: RiskCondition) => {
  const field = conditionFields.find((item) => item.value === condition.field);
  if (!field) return "תנאי לא ידוע";
  if (field.boolean) return field.label;
  const window = condition.windowMinutes ? ` בתוך ${condition.windowMinutes >= 1440 ? `${condition.windowMinutes / 1440} ימים` : `${condition.windowMinutes} דקות`}` : "";
  return `${field.label} לפחות ${condition.value} ${field.suffix ?? ""}${window}`;
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

  return <div className="page-content"><PageHeading eyebrow="כללים אוטומטיים" title="מתי לפתוח התראה?" description="בונים תנאים פשוטים או משלבים כמה תנאים. כשהחוק מתקיים נפתח תיק ונשלח אימייל לפי ההגדרות שלך." action={<button className="primary-button" onClick={() => void addTemplate({ label: "חוק חדש", description: "חוק מותאם לחנות", category: "velocity", enabled: true, logic: "all", conditions: [{ id: crypto.randomUUID(), field: "orders_by_email", operator: "gte", value: 3, windowMinutes: 60 }], action: { severity: "high", openCase: true, emailOwner: true } })}><Plus size={16} /> חוק חדש</button>} />
    <div className="rule-summary"><div><span>חוקים פעילים</span><strong>{rules.filter((rule) => rule.enabled).length}</strong></div><div><span>התראות שנפתחו</span><strong>{rules.reduce((sum, rule) => sum + rule.matches, 0)}</strong></div><div><span>חוקים משולבים</span><strong>{rules.filter((rule) => rule.conditions.length > 1).length}</strong></div><button className="secondary-button"><FileClock size={15} /> היסטוריית שינויים</button></div>

    <section className="recommendations"><div className="recommendation-heading"><div><Sparkles size={18} /><div><strong>המלצות מוכנות</strong><span>שילובים נפוצים שמפחיתים התראות שווא</span></div></div></div><div className="recommendation-grid">{recommendedTemplates.map((template) => <article key={template.label}><div><strong>{template.label}</strong><p>{template.description}</p></div><button className="secondary-button" onClick={() => void addTemplate(template)} disabled={saving}><PlusCircle size={15} /> הוסף לחנות</button></article>)}</div></section>

    {notice ? <div className="rule-recalculation-notice" role="status"><CheckCircle2 size={17} /><div><strong>ההתראות חושבו מחדש</strong><span>{notice}</span></div></div> : null}
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    <div className="rules-list condition-rules">{rules.map((rule) => <article key={rule.id} className={!rule.enabled ? "rule-disabled" : ""}>
      <button className={`switch ${rule.enabled ? "switch-on" : ""}`} onClick={() => void onToggle(rule).then((result) => setNotice(`החוק ${rule.enabled ? "כובה" : "הופעל"} ונבדקו ${result.reviewed} תיקים · ${result.resolved} נסגרו · ${result.reopened} נפתחו מחדש · ${result.active} פעילות`)).catch(() => setError("החוק לא עודכן. נסה שוב."))} aria-label={`${rule.enabled ? "כיבוי" : "הפעלת"} ${rule.label}`}><span /></button>
      <div className="rule-main"><div><h3>{rule.label}</h3>{rule.locked ? <span className="locked-chip"><LockKeyhole size={12} /> חוק מערכת</span> : null}{rule.recommended ? <span className="recommended-chip">מומלץ</span> : null}</div><p>{rule.description}</p><div className="condition-preview"><span className="logic-word">אם {rule.logic === "all" ? "כל" : "לפחות אחד"}</span>{rule.conditions.map((condition) => <span key={condition.id}>{conditionSentence(condition)}</span>)}</div></div>
      <div className="rule-action"><span>אז</span><strong>פתח תיק · {rule.action.severity === "critical" ? "קריטי" : rule.action.severity === "high" ? "גבוה" : rule.action.severity === "medium" ? "בינוני" : "נמוך"}</strong><small>{rule.action.emailOwner ? "ושלח אימייל לבעלים" : "ללא אימייל"}</small></div>
      <div className="rule-matches"><span>הופעל</span><strong className="mono">{rule.matches}</strong><small>פעמים</small></div>
      <button className="secondary-button" onClick={() => setEditing(structuredClone(rule))} disabled={rule.locked}>עריכת תנאים</button>
    </article>)}</div>

    {editing ? <div className="drawer-backdrop rule-editor-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditing(null); }}><aside className="rule-editor" role="dialog" aria-modal="true" aria-label={`עריכת החוק ${editing.label}`}><header><div><span className="eyebrow">עריכת חוק</span><h2>{editing.label}</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="סגירת עורך החוק"><X size={19} /></button></header><div className="rule-editor-body">
      <label className="field-label">שם החוק<input value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} /></label>
      <label className="field-label">הפעל את ההתראה כאשר<select value={editing.logic} onChange={(event) => setEditing({ ...editing, logic: event.target.value as "all" | "any" })}><option value="all">כל התנאים מתקיימים</option><option value="any">לפחות תנאי אחד מתקיים</option></select></label>
      <div className="condition-editor-list">{editing.conditions.map((condition, index) => { const field = conditionFields.find((item) => item.value === condition.field); return <div className="condition-editor" key={condition.id}><span className="condition-number">{index + 1}</span><select value={condition.field} onChange={(event) => { const nextField = event.target.value as RiskConditionField; const nextMeta = conditionFields.find((item) => item.value === nextField); updateCondition(condition.id, { field: nextField, value: nextMeta?.boolean ? true : 1, windowMinutes: nextMeta?.boolean ? undefined : condition.windowMinutes }); }}>{conditionFields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{field?.boolean ? <span className="boolean-condition">כן, התנאי מתקיים</span> : <><span>לפחות</span><input type="number" min="0" value={String(condition.value)} onChange={(event) => updateCondition(condition.id, { value: Number(event.target.value) })} />{condition.windowMinutes !== undefined ? <><span>בתוך</span><input type="number" min="1" value={condition.windowMinutes} onChange={(event) => updateCondition(condition.id, { windowMinutes: Number(event.target.value) })} /><span>דקות</span></> : null}</>} {editing.conditions.length > 1 ? <button className="icon-button" onClick={() => setEditing({ ...editing, conditions: editing.conditions.filter((item) => item.id !== condition.id) })} aria-label="הסרת תנאי"><X size={15} /></button> : null}</div>; })}</div>
      <button className="add-condition-button" onClick={addCondition}><Plus size={15} /> הוסף תנאי נוסף</button>
      <div className="rule-outcome"><strong>כאשר החוק מתקיים</strong><label><span>חומרת ההתראה</span><select value={editing.action.severity} onChange={(event) => setEditing({ ...editing, action: { ...editing.action, severity: event.target.value as Severity } })}><option value="medium">בינוני</option><option value="high">גבוה</option><option value="critical">קריטי</option></select></label><label className="checkbox-row"><input type="checkbox" checked={editing.action.emailOwner} onChange={(event) => setEditing({ ...editing, action: { ...editing.action, emailOwner: event.target.checked } })} /> שלח אימייל לבעלי החנות</label></div>
    </div><footer><button className="secondary-button" onClick={() => setEditing(null)}>ביטול</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "שומר…" : "שמור חוק"}</button></footer></aside></div> : null}
  </div>;
}

function NotificationsScreen({ settings, deliveries, onSave }: { settings: NotificationSettings; deliveries: NotificationDelivery[]; onSave: (settings: NotificationSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [recipients, setRecipients] = useState(settings.recipients.join("\n"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(settings); setRecipients(settings.recipients.join("\n")); }, [settings]);
  const toggleSeverity = (severity: Severity) => setDraft((current) => ({ ...current, severities: current.severities.includes(severity) ? current.severities.filter((item) => item !== severity) : [...current.severities, severity] }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setSaved(false);
    const normalized = recipients.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    await onSave({ ...draft, recipients: normalized });
    setSaving(false); setSaved(true);
  };
  return <div className="page-content"><PageHeading eyebrow="התראות לבעלי החנות" title="מי מקבל אימייל ומתי?" description="כשנפתח תיק בסיכון שבחרת, כל נמען מקבל אימייל עם הסיבה וקישור ישיר לקבלת החלטה." />
    <div className="notification-layout"><form className="notification-settings" onSubmit={submit}>
      <div className="notification-master"><div><Mail size={20} /><div><strong>שליחת התראות באימייל</strong><span>עובד גם עם כתובות Gmail וכל ספק אימייל אחר</span></div></div><button type="button" className={`switch ${draft.enabled ? "switch-on" : ""}`} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} aria-label="הפעלת התראות"><span /></button></div>
      <label className="field-label">כתובות בעלי החנות<span>כתובת אחת בכל שורה. ההתראה נשלחת לכל הכתובות.</span><textarea value={recipients} onChange={(event) => setRecipients(event.target.value)} dir="ltr" rows={4} placeholder="owner@gmail.com" /></label>
      <fieldset><legend>על אילו תיקים לשלוח אימייל?</legend><div className="severity-options">{(["critical", "high", "medium"] as Severity[]).map((severity) => <label key={severity} className={`severity-option ${draft.severities.includes(severity) ? "selected" : ""}`}><input type="checkbox" checked={draft.severities.includes(severity)} onChange={() => toggleSeverity(severity)} /><SeverityBadge severity={severity} /><span>{severity === "critical" ? "דורש טיפול מיידי" : severity === "high" ? "חשד משמעותי" : "כדאי לבדוק"}</span></label>)}</div></fieldset>
      <label className="field-label reminder-field">שלח תזכורת אם התיק עדיין לא טופל אחרי<div><input type="number" min="5" max="1440" value={draft.reminderMinutes} onChange={(event) => setDraft({ ...draft, reminderMinutes: Number(event.target.value) })} /><span>דקות</span></div></label>
      <div className="notification-example"><strong>מה קורה בפועל?</strong><ol><li>המערכת מזהה הזמנה חשודה ופותחת תיק.</li><li>בעלי החנות מקבלים אימייל עם הסיבה והסכום.</li><li>הבעלים מסמנים: בבדיקה, טופל, תקין או הונאה.</li></ol></div>
      <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? "שומר…" : "שמור הגדרות"}</button>{saved ? <span className="saved-message"><CheckCircle2 size={15} /> ההגדרות נשמרו</span> : null}</div>
    </form><section className="delivery-panel"><div className="section-heading"><div><h2>התראות אחרונות</h2><span>סטטוס מסירה לכל נמען</span></div></div>{deliveries.length ? <div className="delivery-list">{deliveries.slice(0, 8).map((delivery) => <article key={delivery.id}><div className="delivery-icon"><Mail size={17} /></div><div><strong>{delivery.recipient}</strong><span>תיק {delivery.caseId}</span></div><span className={`delivery-status delivery-${delivery.status}`}>{delivery.status === "sent" ? "נשלח" : delivery.status === "simulated" ? "לא נשלח — שירות המייל לא הוגדר" : delivery.status === "failed" ? "נכשל" : "בתור"}</span></article>)}</div> : <div className="empty-state"><Mail size={25} /><strong>עדיין לא נשלחו התראות</strong><span>התראות חדשות יופיעו כאן.</span></div>}</section></div>
  </div>;
}

function NetworkScreen({ reports, onRelease }: { reports: BlacklistReport[]; onRelease: (caseId: string) => Promise<void> }) {
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
  return <div className="page-content"><PageHeading eyebrow="רשת הגנה משותפת" title="התאמות למאגר ההונאות" description="אם לקוח דווח כהונאה בחנות אחרת, החנות שלך מקבלת התראה — בלי לראות מי דיווח ובלי גישה למאגר עצמו." />
    <div className="network-hero"><div className="network-visual"><div className="network-center"><Shield size={30} /><span>בדיקה פרטית</span></div>{["מייל", "טלפון", "כתובת"].map((label, i) => <div key={label} className={`network-node node-${i + 1}`}><Fingerprint size={17} />{label}</div>)}</div><div><span className="eyebrow">הפרטים נשארים מוגנים</span><h2>מקבלים תשובה, לא את המאגר</h2><p>האימייל, הטלפון והכתובת מוצפנים לפני הבדיקה. בעלי חנויות יכולים לראות רק שנמצאה התאמה בהזמנה שלהם.</p><ul><li><Shield size={15} /> {reports.length} התאמות פעילות בחנויות שלך</li><li><LockKeyhole size={15} /> פרטי החנות המדווחת לא נחשפים</li><li><FileClock size={15} /> כל בדיקה נשמרת ביומן פעילות</li></ul></div></div>
    <section className="case-section"><div className="section-heading"><div><h2>אנשים ברשימת החסימה</h2><span>{groups.length} אירועים · {activeReports.length} מזהים מוצפנים</span></div></div>{groups.map((group) => { const first = group[0]; return <div className="report-row block-group" key={first.caseId}><div className="report-icon"><Fingerprint /></div><div><strong>{first.reason}</strong><div className="identity-chips">{group.map((report) => <span key={report.id}>{identityLabel[report.keyType]} · {report.maskedValue}</span>)}</div></div><SeverityBadge severity="critical" /><span>ברשימת חסימה</span><button className="secondary-button" disabled={releasing === first.caseId} onClick={() => void release(first.caseId)}>{releasing === first.caseId ? "משחרר…" : "שחרר חסימה"}</button></div>; })}{groups.length === 0 ? <div className="empty-state"><Fingerprint size={25} /><strong>אין עדיין חסימות</strong><span>אימייל, טלפון, כתובת, IP ומזהה Shopify יתווספו רק לאחר אישור הונאה.</span></div> : null}</section>
  </div>;
}

function TeamScreen() {
  return <div className="page-content"><PageHeading eyebrow="גישה והרשאות" title="מי יכול לראות ולטפל בהתראות?" description="כל משתמש יקבל גישה רק לחנויות של הארגון שלו ובהתאם לתפקיד שיוגדר לו." action={<button className="primary-button"><Plus size={16} /> הזמנת משתמש</button>} /><section className="compact-overview"><div><span>משתמשים פעילים</span><strong>0</strong><small>לא נוספו משתמשים</small></div><div><span>הזמנות ממתינות</span><strong>0</strong><small>אין הזמנות פתוחות</small></div><div><span>אימות דו־שלבי</span><strong>—</strong><small>יוגדר בעת הצטרפות</small></div></section><section className="case-section"><div className="section-heading"><div><h2>חברי הצוות</h2><span>משתמשים אמיתיים בלבד</span></div></div><div className="empty-state"><UserRoundCog size={25} /><strong>עדיין לא הוזמנו משתמשים</strong><span>לא מוצגים כאן חשבונות לדוגמה. משתמש חדש יופיע לאחר שליחת הזמנה.</span></div></section></div>;
}

function PlatformScreen() {
  return <div className="page-content"><PageHeading eyebrow="לבעל הפלטפורמה בלבד" title="ניהול הפלטפורמה" description="כאן אתה מנהל לקוחות וחיבורי Shopify. כל לקוח נכנס לסביבה נפרדת ורואה רק את החנויות שלו." action={<button className="primary-button"><Plus size={16} /> פתיחת לקוח חדש</button>} />
    <section className="metric-grid"><Metric icon={<Building2 />} label="לקוחות פעילים" value="0" detail="אין עדיין לקוחות" /><Metric icon={<Activity />} label="עסקאות שנסרקו היום" value="0" detail="יתעדכן לאחר חיבור חנות" tone="success" /><Metric icon={<ShieldAlert />} label="תיקים קריטיים פתוחים" value="0" detail="אין נתונים" tone="critical" /><Metric icon={<RefreshCcw />} label="חיבורים שדורשים טיפול" value="0" detail="אין חיבורים" tone="warning" /></section>
    <section className="case-section"><div className="section-heading"><div><h2>לקוחות וחיבורי Shopify</h2><span>מידע של לקוח אחד לעולם לא מוצג ללקוח אחר</span></div></div><div className="empty-state"><Building2 size={25} /><strong>אין עדיין לקוחות בפלטפורמה</strong><span>הלקוח הראשון יופיע כאן רק לאחר שתפתח עבורו גישה ותחבר חנות אמיתית.</span></div></section>
  </div>;
}
