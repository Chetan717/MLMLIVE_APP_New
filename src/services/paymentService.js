import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "@firebase-config";

const functions = getFunctions(
  app,
  import.meta.env.VITE_PAYMENT_FUNCTIONS_REGION || "asia-south1",
);
const calls = new Map();
const cache = new Map();
const inflight = new Map();
let cacheGeneration = 0;
let scriptPromise;
const invoke = async (name, data) => {
  if (!auth.currentUser) throw new Error("Sign in before purchasing a plan.");
  const key = name;
  if (!calls.has(key))
    calls.set(
      key,
      httpsCallable(functions, name, {
        timeout: 60000,
      }),
    );
  return (await calls.get(key)(data)).data;
};
function cached(name, companyId, force = false) {
  const key = `${auth.currentUser?.uid}:${name}:${companyId}`;
  const entry = cache.get(key);
  if (!force && entry && entry.until > Date.now())
    return Promise.resolve(entry.value);
  if (!force && inflight.has(key)) return inflight.get(key);
  const generation = cacheGeneration;
  const pending = invoke(name, { companyId })
    .then((value) => {
      if (generation === cacheGeneration && inflight.get(key) === pending) cache.set(key, {
        value,
        until: Date.now() + (name === "paymentCatalog" ? 60000 : 30000),
      });
      return value;
    })
    .finally(() => { if (inflight.get(key) === pending) inflight.delete(key); });
  inflight.set(key, pending);
  return pending;
}
export const getPaymentCatalog = (companyId, force = false) =>
  cached("paymentCatalog", companyId, force);
export const getPaymentEntitlement = (companyId, force = false) =>
  cached("paymentEntitlement", companyId, force);
export const getPaymentHistory = (companyId, { force = false, cursor } = {}) =>
  cursor
    ? invoke("paymentHistory", { companyId, cursor })
    : cached("paymentHistory", companyId, force);
export const getLegacyPaymentHistory = (companyId, cursor) =>
  invoke("paymentLegacyHistory", { companyId, ...(cursor ? { cursor } : {}) });
export const getPaymentQuote = (data) => invoke("paymentQuote", data);
export const createPaymentOrder = (data) =>
  invoke("paymentCreateOrder", data);
export const verifyPayment = (data) => invoke("paymentVerify", data);
export const checkPayment = (purchaseId) =>
  invoke("paymentStatus", { purchaseId });
export function clearPaymentCache() {
  cacheGeneration++;
  cache.clear();
  inflight.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mlmlive:payment-updated"));
}
export function paymentError(error) {
  if (error?.code?.includes("unauthenticated"))
    return "Your session expired. Sign in again before payment.";
  if (error?.code?.includes("resource-exhausted"))
    return "Too many payment attempts. Please try later.";
  if (error?.code?.includes("permission-denied"))
    return "Payment could not be verified for this account. Use Check payment or contact support.";
  return String(error?.message || "Payment is temporarily unavailable.")
    .replace(/^Firebase:\s*/i, "")
    .slice(0, 240);
}
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const timeout = setTimeout(() => {
      script.remove();
      scriptPromise = null;
      reject(new Error("Checkout took too long to load. Try again."));
    }, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.Razorpay) resolve();
      else {
        scriptPromise = null;
        reject(new Error("Checkout could not load."));
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      scriptPromise = null;
      reject(
        new Error("Checkout could not load. Check your internet connection."),
      );
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
// Only opaque purchase IDs are cached. A storage edit cannot activate access.
const pendingKey = () =>
  `mlmlive:payment-pending:${auth.currentUser?.uid || "none"}`;
export function rememberPendingPurchase(purchaseId) {
  try {
    localStorage.setItem(pendingKey(), purchaseId);
  } catch {}
}
export function getPendingPurchase() {
  try {
    return localStorage.getItem(pendingKey()) || "";
  } catch {
    return "";
  }
}
export function forgetPendingPurchase() {
  try {
    localStorage.removeItem(pendingKey());
  } catch {}
}
export const rupees = (paise) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(paise || 0) / 100,
  );
