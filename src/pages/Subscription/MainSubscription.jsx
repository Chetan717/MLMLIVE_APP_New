import { useCallback, useEffect, useRef, useState } from "react";
import {
  Gem,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  History,
  CalendarDays,
  Download,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { useSelectedCompany } from "../../Context/SelectedCompanyContext";
import { useAuth } from "../../Auth/AuthContext";
import { CheckoutModal } from "./CheckoutModal";
import {
  getPaymentCatalog,
  getPaymentHistory,
  getLegacyPaymentHistory,
  checkPayment,
  paymentError,
  getPendingPurchase,
  forgetPendingPurchase,
  clearPaymentCache,
  rupees,
} from "../../services/paymentService";
import { jsPDF } from "jspdf";

const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const label = (value) =>
  ({
    paid: "Paid",
    failed: "Order not created",
    created: "Awaiting payment",
    creating: "Creating order",
    creation_unknown: "Confirmation pending",
    refunded: "Refunded",
    partially_refunded: "Partially refunded",
    disputed: "Under review",
  })[value] || "Pending";

function receipt(item) {
  const pdf = new jsPDF();
  pdf.setFontSize(22);
  pdf.text("MLMLIVE", 20, 25);
  pdf.setFontSize(12);
  pdf.text("Payment receipt", 20, 36);
  const lines = [
    ["Receipt", item.purchaseId],
    ["Company", item.companyName],
    ["Plan", item.plan.PlanName],
    ["Status", label(item.status)],
    ["Purchased", date(item.createdAtMs)],
    ["Order", item.orderId || "Pending"],
    ["Plan price (INR)", (item.price.basePaise / 100).toFixed(2)],
    ["Discount (INR)", (item.price.discountPaise / 100).toFixed(2)],
    ["Taxable value (INR)", (item.price.taxablePaise / 100).toFixed(2)],
    ["GST 18% (INR)", (item.price.gstPaise / 100).toFixed(2)],
    ["Total paid (INR)", (item.price.totalPaise / 100).toFixed(2)],
    ["Refunded (INR)", (item.refundedPaise / 100).toFixed(2)],
    ["Starts", date(item.startsAtMs)],
    ["Expires", date(item.subscriptionExpiresAtMs)],
  ];
  lines.forEach(([key, value], i) => {
    pdf.text(key, 20, 54 + i * 11);
    pdf.text(pdf.splitTextToSize(String(value || "—"), 112), 80, 54 + i * 11);
  });
  pdf.setFontSize(9);
  pdf.text("Payment acknowledgement. This is not a GST tax invoice.", 20, 230);
  pdf.save(`MLMLIVE_receipt_${item.purchaseId}.pdf`);
}

export default function MainSubscription() {
  const { selectedCompany } = useSelectedCompany();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState(null),
    [history, setHistory] = useState([]),
    [legacy, setLegacy] = useState([]);
  const [entitlement, setEntitlement] = useState(null),
    [cursor, setCursor] = useState(null);
  const [tab, setTab] = useState("plans"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [selectedPlan, setSelectedPlan] = useState(null),
    [open, setOpen] = useState(false),
    [checking, setChecking] = useState("");
  const [notice, setNotice] = useState(""),
    [moreLoading, setMoreLoading] = useState(false);
  const [legacyCursor, setLegacyCursor] = useState(null),
    [legacyLoaded, setLegacyLoaded] = useState(false);
  const generation = useRef(0);
  const companyId = selectedCompany?.id;
  const load = useCallback(
    async (force = false) => {
      const run = ++generation.current;
      if (!companyId || !user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [plans, records] = await Promise.all([
          getPaymentCatalog(companyId, force),
          getPaymentHistory(companyId, { force }),
        ]);
        if (run !== generation.current) return;
        setCatalog(plans);
        setHistory(records.items);
        setEntitlement(records.entitlement);
        setCursor(records.cursor);
      } catch (error) {
        if (run === generation.current) setError(paymentError(error));
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [companyId, user?.uid],
  );
  useEffect(() => {
    setCatalog(null);
    setHistory([]);
    setLegacy([]);
    setLegacyLoaded(false);
    setLegacyCursor(null);
    setEntitlement(null);
    setSelectedPlan(null);
    setOpen(false);
    setNotice("");
    load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function loadLegacy() {
    if (moreLoading) return;
    setMoreLoading(true);
    const run = generation.current;
    try {
      const page = await getLegacyPaymentHistory(companyId, legacyCursor);
      if (run !== generation.current) return;
      setLegacy((previous) => [
        ...previous,
        ...page.items.filter(
          (item) => !previous.some((old) => old.id === item.id),
        ),
      ]);
      setLegacyCursor(page.cursor);
      setLegacyLoaded(true);
    } catch (error) {
      setNotice(paymentError(error));
    } finally {
      setMoreLoading(false);
    }
  }
  async function recover(purchaseId) {
    if (!purchaseId || checking) return;
    setChecking(purchaseId);
    setNotice("");
    const run = generation.current;
    try {
      const result = await checkPayment(purchaseId);
      if (run !== generation.current) return;
      if (result.status === "paid") {
        forgetPendingPurchase();
        clearPaymentCache();
        await load(true);
        setNotice("Payment confirmed. Your subscription is ready.");
      } else
        setNotice(
          ["refunded", "partially_refunded", "disputed"].includes(result.status)
            ? "This payment has a refund or review. Please contact support with the receipt ID."
            : "Payment is pending. If money was debited, wait and check again before another purchase.",
        );
    } catch (error) {
      if (run === generation.current) setNotice(paymentError(error));
    } finally {
      setChecking("");
    }
  }
  async function more() {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    const run = generation.current;
    try {
      const page = await getPaymentHistory(companyId, { cursor });
      if (run !== generation.current) return;
      setHistory((old) => [
        ...old,
        ...page.items.filter(
          (item) =>
            !old.some((existing) => existing.purchaseId === item.purchaseId),
        ),
      ]);
      setCursor(page.cursor);
    } catch (error) {
      setNotice(paymentError(error));
    } finally {
      setMoreLoading(false);
    }
  }
  const active = entitlement?.status === "active";
  const current = history.find(
    (item) => item.purchaseId === entitlement?.currentPurchaseId,
  );
  const pending = getPendingPurchase();
  return (
    <div className="min-h-full bg-background text-foreground px-4 py-5 md:p-8 pb-24">
      <div className="max-w-4xl mx-auto">
        <header className="relative overflow-hidden rounded-[28px] p-6 md:p-8 text-white bg-gradient-to-br from-[#2F80EA] to-[#1543a3] mb-5 shadow-lg">
          <div className="absolute w-52 h-52 rounded-full border-[24px] border-white/5 -right-12 -top-20" />
          <div className="relative flex justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-white/70">
                {selectedCompany?.name || "MLMLIVE"}
              </p>
              <h1 className="text-2xl md:text-3xl font-bold mt-2">
                Your next level starts here.
              </h1>
              <p className="text-sm text-white/80 mt-2 max-w-sm">
                Choose the right plan for your company and create with
                confidence.
              </p>
            </div>
            <Gem className="w-10 h-10 md:w-14 md:h-14 text-amber-200 shrink-0 mt-3" />
          </div>
          <p className="relative text-[11px] mt-5 flex items-center gap-2 text-white/80">
            <ShieldCheck className="w-4 h-4" /> Secure Razorpay checkout · Clear
            pricing
          </p>
        </header>
        {catalog?.mode === "test" && (
          <p className="text-sm border border-amber-400/30 bg-amber-400/10 rounded-xl p-3 mb-4">
            Test mode · No real money is charged.
          </p>
        )}
        {entitlement && (
          <section className="rounded-2xl border border-border bg-accent/5 p-5 mb-5">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-accent tracking-wide">
                  {active
                    ? "Current subscription"
                    : entitlement.status === "scheduled"
                      ? "Upcoming subscription"
                      : "Previous subscription"}
                </p>
                <h2 className="text-lg font-bold mt-1">
                  {current?.plan.PlanName ||
                    (active ? "Premium access" : "Your paid plan")}
                </h2>
              </div>
              {active ? (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              ) : (
                <Clock3 className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Paid through</p>
                <p className="font-semibold mt-1">
                  {date(entitlement.expiresAtMs)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  Current download allowance
                </p>
                <p className="font-semibold mt-1">
                  {entitlement.unlimitedDownloads
                    ? "Unlimited"
                    : entitlement.remainingDownloads}
                </p>
              </div>
            </div>
          </section>
        )}
        {pending && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 mb-4 flex items-center justify-between gap-3">
            <p className="text-sm">Have a payment awaiting confirmation?</p>
            <button
              className="shrink-0 text-sm font-bold text-accent disabled:opacity-50"
              disabled={Boolean(checking)}
              onClick={() => recover(pending)}
            >
              {checking ? "Checking…" : "Check payment"}
            </button>
          </div>
        )}
        {notice && (
          <p
            role="status"
            className="p-4 mb-4 border border-border rounded-2xl text-sm leading-relaxed"
          >
            {notice}
          </p>
        )}
        <div className="flex gap-2 items-center mb-5">
          <div className="flex flex-1 gap-1 bg-muted/40 p-1 rounded-2xl border border-border">
            {[
              ["plans", "Plans", Gem],
              ["history", "Payment history", History],
            ].map(([key, name, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === key ? "bg-accent text-white shadow-sm" : "text-muted-foreground"}`}
              >
                <Icon className="w-4 h-4" />
                {name}
              </button>
            ))}
          </div>
          <button
            aria-label="Refresh plans and payments"
            disabled={loading}
            onClick={() => load(true)}
            className="p-3 border border-border rounded-xl"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {error ? (
          <div
            role="alert"
            className="p-5 border border-red-400/30 bg-red-400/10 rounded-2xl"
          >
            <p className="text-sm">{error}</p>
            <button
              onClick={() => load(true)}
              className="mt-3 font-bold text-accent text-sm"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="grid md:grid-cols-2 gap-4" aria-label="Loading plans">
            <div className="animate-pulse h-64 bg-muted rounded-3xl" />
            <div className="animate-pulse h-64 bg-muted rounded-3xl" />
          </div>
        ) : tab === "plans" ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-bold text-lg">
                Plans for {catalog?.companyName}
              </h2>
              <span className="text-xs text-muted-foreground">
                GST added at checkout
              </span>
            </div>
            {!catalog?.plans.length ? (
              <div className="p-10 border border-border rounded-3xl text-center">
                <Gem className="w-10 h-10 mx-auto text-accent mb-3" />
                <h3 className="font-bold">Plans are coming soon</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Published plans for your company will appear here.
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                {catalog.plans.map((plan) => (
                  <article
                    key={plan.planId}
                    className="rounded-3xl border border-border overflow-hidden bg-background shadow-sm flex flex-col"
                  >
                    {plan.image_url && (
                      <img
                        src={plan.image_url}
                        alt=""
                        className="w-full aspect-video object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-bold text-accent bg-accent/10 py-1.5 px-3 rounded-full uppercase tracking-wide">
                          {plan.Type}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {plan.Duration || `${plan.Day_value} days`}
                        </span>
                      </div>
                      <h3 className="font-bold text-xl mt-4">
                        {plan.PlanName}
                      </h3>
                      <p className="text-3xl font-bold mt-2">
                        {rupees(plan.amountPaise)}
                        <span className="text-xs text-muted-foreground font-normal ml-1">
                          + GST
                        </span>
                      </p>
                      {plan.Description && (
                        <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">
                          {plan.Description}
                        </p>
                      )}
                      <div className="space-y-2.5 text-sm mt-5 mb-6">
                        <p className="flex items-center gap-2">
                          <CalendarDays className="w-4 h-4 text-accent" />
                          {plan.Day_value.toLocaleString("en-IN")} days of
                          access
                        </p>
                        <p className="flex items-center gap-2">
                          <Download className="w-4 h-4 text-accent" />
                          {plan.unlimitedDownloads
                            ? "Unlimited downloads"
                            : `${plan.downloads.toLocaleString("en-IN")} downloads included`}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedPlan(plan);
                          setOpen(true);
                        }}
                        className="mt-auto flex items-center justify-center gap-2 bg-accent text-white rounded-2xl py-3 font-bold text-sm"
                      >
                        Choose plan
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <section className="space-y-3">
            {!history.length && !legacy.length && (
              <div className="p-10 border border-border rounded-3xl text-center">
                <History className="w-9 h-9 mx-auto text-muted-foreground mb-3" />
                <h3 className="font-bold">Your payment history starts here</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Orders, payment status and receipts will appear after
                  checkout.
                </p>
              </div>
            )}
            {history.map((item) => (
              <article
                key={item.purchaseId}
                className="p-4 md:p-5 rounded-2xl border border-border"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{item.plan.PlanName}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {date(item.createdAtMs)} · {item.companyName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{rupees(item.price.totalPaise)}</p>
                    <p
                      className={`text-xs mt-1 ${item.status === "paid" ? "text-green-600" : "text-muted-foreground"}`}
                    >
                      {label(item.status)}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 break-all">
                  {item.purchaseId}
                </p>
                {item.status === "paid" && (
                  <p className="text-xs mt-2">
                    {item.startsAtMs > Date.now() ? "Scheduled" : "Period"}:{" "}
                    {date(item.startsAtMs)} –{" "}
                    {date(item.subscriptionExpiresAtMs)}
                  </p>
                )}
                <div className="flex gap-3 mt-3">
                  {item.status === "paid" ? (
                    <button
                      onClick={() => receipt(item)}
                      className="text-xs font-bold text-accent"
                    >
                      Download receipt
                    </button>
                  ) : (
                    ![
                      "failed",
                      "refunded",
                      "partially_refunded",
                      "disputed",
                    ].includes(item.status) && (
                      <button
                        disabled={Boolean(checking)}
                        onClick={() => recover(item.purchaseId)}
                        className="text-xs font-bold text-accent disabled:opacity-50"
                      >
                        {checking === item.purchaseId
                          ? "Checking…"
                          : "Check payment"}
                      </button>
                    )
                  )}
                </div>
              </article>
            ))}
            {cursor && (
              <button
                disabled={moreLoading}
                onClick={more}
                className="w-full border border-border rounded-xl py-3 font-bold text-sm"
              >
                {moreLoading ? "Loading…" : "Load older payments"}
              </button>
            )}
            {(!legacyLoaded || legacyCursor) && (
              <button
                disabled={moreLoading}
                onClick={loadLegacy}
                className="w-full py-3 text-sm font-semibold text-accent"
              >
                {moreLoading
                  ? "Loading…"
                  : legacyLoaded
                    ? "Load more earlier subscriptions"
                    : "View earlier subscriptions"}
              </button>
            )}
            {legacy.length > 0 && (
              <div className="pt-4">
                <h3 className="font-bold mb-3">Earlier subscriptions</h3>
                {legacy.map((item) => (
                  <div
                    key={item.id}
                    className="border border-border rounded-2xl p-4 mb-3"
                  >
                    <p className="font-semibold">{item.plan}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {date(item.startdate)} – {date(item.expirydate)} ·{" "}
                      {rupees(item.PaymentAmount * 100)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {item.company || "Legacy company record"} · {item.payment}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <CheckoutModal
          key={`${companyId}:${selectedPlan?.planId || ""}`}
          plan={selectedPlan}
          isOpen={open}
          setIsOpen={setOpen}
          suggestedCoupon={catalog?.suggestedCoupon || ""}
          onBack={() => setOpen(false)}
          onPaymentSuccess={() => {
            setNotice("Payment confirmed. Your subscription is ready.");
            load(true);
          }}
        />
      </div>
    </div>
  );
}
