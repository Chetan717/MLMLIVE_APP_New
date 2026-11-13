import { useEffect, useRef, useState } from "react";
import { X, ShieldCheck, LoaderCircle, ArrowLeft } from "lucide-react";
import { useSelectedCompany } from "../../Context/SelectedCompanyContext";
import { getUser } from "../../utils/authStorage";
import {
  getPaymentQuote,
  createPaymentOrder,
  verifyPayment,
  checkPayment,
  loadRazorpay,
  paymentError,
  rememberPendingPurchase,
  forgetPendingPurchase,
  clearPaymentCache,
  rupees,
} from "../../services/paymentService";

export function CheckoutModal({
  plan,
  isOpen,
  setIsOpen,
  onBack,
  onPaymentSuccess,
  suggestedCoupon = "",
}) {
  const { selectedCompany } = useSelectedCompany();
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [message, setMessage] = useState("");
  const [purchase, setPurchase] = useState(null);
  const running = useRef(false),
    quoteGeneration = useRef(0),
    requestId = useRef("");
  const dialogRef = useRef(null),
    mounted = useRef(true),
    activeCheckout = useRef(null);
  const selection = `${selectedCompany?.id || ""}:${plan?.planId || ""}`;
  const currentSelection = useRef(selection);
  currentSelection.current = selection;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      quoteGeneration.current++;
      activeCheckout.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!isOpen || !plan?.planId || !selectedCompany?.id || running.current)
      return;
    setCoupon(suggestedCoupon);
    setPurchase(null);
    requestId.current = "";
    refreshQuote(suggestedCoupon);
  }, [isOpen, selection]);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const key = (event) => {
      if (event.key === "Escape" && !running.current) setIsOpen(false);
      if (event.key !== "Tab") return;
      const nodes = [
        ...(dialogRef.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) || []),
      ];
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [isOpen, setIsOpen]);

  async function refreshQuote(code) {
    const generation = ++quoteGeneration.current;
    setQuoting(true);
    setQuote(null);
    setMessage("");
    requestId.current = "";
    try {
      const result = await getPaymentQuote({
        companyId: selectedCompany.id,
        planId: plan.planId,
        couponCode: code,
      });
      if (mounted.current && generation === quoteGeneration.current)
        setQuote(result);
    } catch (error) {
      if (mounted.current && generation === quoteGeneration.current)
        setMessage(paymentError(error));
    } finally {
      if (mounted.current && generation === quoteGeneration.current)
        setQuoting(false);
    }
  }
  function finish(result) {
    if (result.status !== "paid") return false;
    if (!mounted.current) return true;
    forgetPendingPurchase();
    clearPaymentCache();
    if (mounted.current) {
      setMessage("");
      setIsOpen(false);
    }
    onPaymentSuccess?.();
    return true;
  }
  async function recover() {
    if (!purchase || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await checkPayment(purchase.purchaseId);
      if (!finish(result))
        setMessage(
          ["refunded", "partially_refunded", "disputed"].includes(result.status)
            ? "This payment has been refunded or is under review. Contact support with your receipt ID."
            : "Payment is still pending. If money was debited, wait and check again. Do not pay twice.",
        );
    } catch (error) {
      setMessage(paymentError(error));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function pay() {
    if (
      running.current ||
      !quote ||
      quoting ||
      quote.companyId !== selectedCompany?.id
    )
      return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const checkoutSelection = selection;
    try {
      await loadRazorpay();
      if (!mounted.current) return;
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const order = await createPaymentOrder({
        companyId: quote.companyId,
        planId: quote.plan.planId,
        couponCode: quote.couponCode,
        quoteId: quote.quoteId,
        requestId: requestId.current,
      });
      if (!mounted.current) return;
      setPurchase(order);
      rememberPendingPurchase(order.purchaseId);
      if (finish(order)) {
        running.current = false;
        setBusy(false);
        return;
      }
      if (!order.orderId)
        throw new Error(
          "Order is pending. Use Check payment before another purchase.",
        );
      if (currentSelection.current !== checkoutSelection)
        throw new Error(
          "Company selection changed. Check this payment in its original company.",
        );
      const user = getUser() || {};
      let verifying = false;
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.price.totalPaise,
        currency: "INR",
        name: "MLMLIVE",
        description: `${order.companyName} · ${order.plan.PlanName}`,
        prefill: {
          name: user.name || "",
          contact: user.mobileNo || "",
          email: user.email || "",
        },
        theme: { color: "#2F80EA" },
        retry: { enabled: true, max_count: 2 },
        handler: async (response) => {
          if (verifying) return;
          verifying = true;
          try {
            const result = await verifyPayment({
              purchaseId: order.purchaseId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            if (!finish(result) && mounted.current)
              setMessage(
                "Payment capture is pending. Use Check payment; your plan activates only after confirmation.",
              );
          } catch (error) {
            if (mounted.current)
              setMessage(
                `${paymentError(error)} If debited, use Check payment. Receipt: ${order.purchaseId}`,
              );
          } finally {
            running.current = false;
            if (mounted.current) setBusy(false);
          }
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (verifying) return;
            running.current = false;
            if (mounted.current) {
              setBusy(false);
              setMessage(
                "Checkout closed. If money was debited, use Check payment before trying again.",
              );
            }
          },
        },
      });
      activeCheckout.current = checkout;
      checkout.on("payment.failed", () => {
        // UI feedback only. Signed webhooks record genuine provider failures.
        if (mounted.current)
          setMessage(
            "Payment was not completed. Check payment status before retrying.",
          );
      });
      checkout.open();
    } catch (error) {
      running.current = false;
      setBusy(false);
      setMessage(paymentError(error));
      if (error?.code?.includes("failed-precondition")) {
        setQuote(null);
        requestId.current = "";
      }
    }
  }
  if (!isOpen || !plan) return null;
  const price = quote?.price;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
        tabIndex={-1}
        className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-3xl bg-background text-foreground border border-border shadow-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="text-xs text-accent font-bold uppercase tracking-wider">
              {selectedCompany?.name}
            </p>
            <h2 id="payment-title" className="text-xl font-bold mt-1">
              Confirm your plan
            </h2>
          </div>
          <button
            disabled={busy}
            onClick={() => setIsOpen(false)}
            aria-label="Close checkout"
            className="p-2 rounded-full hover:bg-muted disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="rounded-2xl bg-accent/5 border border-accent/20 p-4 mb-4">
          <p className="font-bold">{quote?.plan.PlanName || plan.PlanName}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {plan.Day_value} days ·{" "}
            {plan.unlimitedDownloads
              ? "Unlimited downloads"
              : `${plan.downloads} downloads`}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Renewal begins after your current paid period ends. Final dates
            appear after payment.
          </p>
        </div>
        <label htmlFor="payment-coupon" className="text-sm font-semibold">
          Coupon code
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) refreshQuote(coupon);
          }}
          className="flex gap-2 mt-2 mb-4"
        >
          <input
            id="payment-coupon"
            value={coupon}
            maxLength={6}
            disabled={busy || quoting}
            onChange={(e) => {
              setCoupon(
                e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase(),
              );
              setQuote(null);
              requestId.current = "";
            }}
            className="min-w-0 flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2.5 font-mono tracking-widest"
            placeholder="Optional"
            autoComplete="off"
          />
          <button
            disabled={
              busy || quoting || (coupon.length > 0 && coupon.length !== 6)
            }
            className="rounded-xl bg-muted px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            {quoting ? "Checking…" : "Apply"}
          </button>
        </form>
        {price ? (
          <dl className="space-y-3 p-4 rounded-2xl border border-border text-sm">
            <div className="flex justify-between">
              <dt>Plan price</dt>
              <dd>{rupees(price.basePaise)}</dd>
            </div>
            {price.discountPaise > 0 && (
              <div className="flex justify-between text-green-600">
                <dt>Discount ({price.discountBps / 100}%)</dt>
                <dd>− {rupees(price.discountPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Taxable amount</dt>
              <dd>{rupees(price.taxablePaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>GST ({price.gstBps / 100}%)</dt>
              <dd>{rupees(price.gstPaise)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-lg font-bold">
              <dt>Total</dt>
              <dd className="text-accent">{rupees(price.totalPaise)}</dd>
            </div>
          </dl>
        ) : (
          <div className="p-5 text-sm text-muted-foreground border border-border rounded-2xl">
            {quoting
              ? "Fetching your current total…"
              : "Apply or refresh the quote to see your total."}
          </div>
        )}
        {message && (
          <p
            role="status"
            className="mt-4 text-sm leading-relaxed p-3 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-200 break-words"
          >
            {message}
          </p>
        )}
        {purchase && (
          <p className="text-xs text-muted-foreground mt-3 break-all">
            Receipt: {purchase.purchaseId}
          </p>
        )}
        <button
          onClick={pay}
          disabled={busy || quoting || !quote}
          className="flex items-center justify-center gap-2 w-full rounded-2xl bg-accent text-white py-3.5 font-bold mt-5 disabled:opacity-40"
        >
          {busy ? (
            <>
              <LoaderCircle className="w-4 h-4 animate-spin" /> Confirming
              payment…
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" /> Pay{" "}
              {price ? rupees(price.totalPaise) : "securely"}
            </>
          )}
        </button>
        {purchase && (
          <button
            disabled={busy}
            onClick={recover}
            className="w-full border border-border rounded-xl py-3 mt-2 text-sm font-semibold"
          >
            Check payment
          </button>
        )}
        {!quote && !quoting && (
          <button
            onClick={() => refreshQuote(coupon)}
            disabled={busy}
            className="w-full border border-border rounded-xl py-3 mt-2 text-sm font-semibold"
          >
            Refresh quote
          </button>
        )}
        <button
          disabled={busy}
          onClick={onBack}
          className="flex items-center justify-center gap-2 w-full py-3 text-sm text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to plan
        </button>
        <p className="text-[11px] text-center text-muted-foreground">
          Payment handled by Razorpay. MLMLIVE never receives your card number
          or CVV.
        </p>
      </section>
    </div>
  );
}
