# App payment setup — CAPTCHA nahi chahiye

App mein Plans bottom tab aur selected company ke plans available hain. Payment
amount, discount, GST, commission aur subscription server se calculate hote hain.

1. Apne existing production Firebase aur collection environment values rakhein.
   App aur Admin same Firebase project use karein.
2. App environment mein `VITE_PAYMENT_FUNCTIONS_REGION=asia-south1` rakhein.
   CAPTCHA site key/secret nahi chahiye. Purane
   `VITE_FIREBASE_APPCHECK_SITE_KEY` aur `VITE_APPCHECK_DEBUG_TOKEN` hata dein.
3. Admin package ke `RAZORPAY_SETUP_HINDI.md` se backend keys, merged rules,
   payment functions aur webhook setup/deploy complete karein. Purane deployed
   App Check-enforced functions ko updated backend se redeploy karna zaroori hai.
4. Apne App folder mein:

```bash
npm ci --legacy-peer-deps
npm run build
```

Fresh build ko apne existing App hosting par deploy karein. Agar manually
Firebase APIs ke liye App Check enforcement on kiya tha, Admin setup ke step 3
ko follow karein. Firebase login aur Security Rules enabled rahenge.

Razorpay secret ya shared payment API key frontend mein kabhi na daalein. Public
checkout key, order ID aur exact paise amount backend se aate hain. Existing
Firebase login required hai; CAPTCHA setup required nahi hai.

Payment creation defaults to disabled until Admin backend setup is complete.
No production deployment or real merchant transaction was performed here.
Test/live data is isolated. Existing free editor/export policy is retained.
