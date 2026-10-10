# Real-phone test checklist

Do this on the deployed `https://` address, on **one Android phone (Chrome)** and **one iPhone (Safari)**
if you have both. Tick each box only when you saw it happen on the phone. Anything that fails: take a
screenshot (and copy any message from *More → Setup check*) and send it over.

| # | Test | Steps | Expected result | Android | iPhone |
|---|---|---|---|---|---|
| 1 | **Install to home screen** | Open the address in Chrome / Safari. Follow the "Get the Slay app" sheet (Android: *Install*; iPhone: Share → *Add to Home Screen*). Open Slay from the new icon. | Slay icon on the home screen; opens full screen with the rose launch screen, no browser bar. *Setup check → Installed on this phone* says **Yes**. | ☐ | ☐ |
| 2 | **Sign up / sign in with password** | Teza: setup code from the Railway log. Friend: *New here? Create an account*, Teza approves under *More → Team*. | Both land on the dashboard. | ☐ | ☐ |
| 3 | **Phone confirmation by SMS** (after Sparrow is set up) | New account signs in. | Asked to confirm the phone; a real text arrives; entering the code completes setup. | ☐ | ☐ |
| 4 | **Forgot password** (after email is set up, DEPLOY.md Part 3) | Sign out → *Forgot password?* → email. | Code arrives by email; new password works. | ☐ | ☐ |
| 5 | **Test SMS** | *More → Setup check → Send test SMS*. | Green result **and** the text arrives. | ☐ | – |
| 6 | **Fingerprint / face sign-in** | Sign in with password → accept *Faster sign-in* (or *More → Security → Turn on*). Sign out. Tap *Sign in with fingerprint / face unlock*. | The phone's real fingerprint / Face ID prompt appears; you're signed in without typing. | ☐ | ☐ |
| 7 | **Notifications: turn on** | Accept the *Security alerts* offer (or *More → Notifications → Turn on for this phone*) and tap **Allow**. | *Setup check → Phone notifications* says **On for this phone**. iPhone: only works from the installed app (test 1). | ☐ | ☐ |
| 8 | **Notification arrives while Slay is closed** | *Setup check → Send test notification (in 10 seconds)*, then immediately close Slay or lock the phone. | "Slay notifications are working" appears on the lock screen / notification shade. | ☐ | ☐ |
| 9 | **Real security alert** | Sign in to Teza's account from a *different* phone or a computer browser that has never used Slay. | Teza's and the friend's phones get a notification "…signed in from a device not used before…", even with Slay closed. | ☐ | ☐ |
| 10 | **Normal sign-ins stay quiet** | Sign out and in again on a phone that has used Slay before. | No notification. | ☐ | ☐ |
| 11 | **Voice entry – English** | *+ (new order)*. In the listening bar choose **English**. Tap the mic next to **Delivery due** and say "October 10"; next to **Add item** say a product and colour, e.g. "black kurta"; next to **Size** say "42"; next to **Price each** say "2500". | Allow the microphone when asked. Each time, only that field fills (Delivery due = 10 Oct, the product is added, size 42, price 2500) and a message shows what was filled. | ☐ | ☐ |
| 12 | **Voice entry – Nepali** | Choose **नेपाली** in the bar. Mic next to **Order came from**: "टिकटक"; **Add item**: "कालो कुर्ता"; **Size**: "बयालीस"; **Price each**: "पच्चीस सय"; **Delivery due**: "भोलि"; **Payment**: "क्यास अन डेलिभरी". | Each field fills with exactly that value. On iPhone, Nepali needs `TRANSCRIBE_API_KEY` (see DEPLOY.md); without it, use English or type. | ☐ | ☐ |
| 13 | **Live stock sync** | Both phones on *Stock*. Save an order on one. | The count drops on the other phone within a second or two, without refreshing. | ☐ | ☐ |
| 14 | **Invoice – Share** | Open an order → *Invoice → Share → As a PDF*; again with *As a picture* and *As a text message*. | The phone's own share sheet opens; sending to WhatsApp / Messenger works (PDF arrives as a document, picture as a photo). | ☐ | ☐ |
| 15 | **Invoice – Save** | *Invoice → Save → PDF*, then *Picture*. | Android: files appear in Downloads / gallery. iPhone: share sheet opens → *Save to Files* / *Save Image* works. | ☐ | ☐ |
| 16 | **Invoice – Print** | *Invoice → Print*. | The phone's print screen opens with the invoice (you can also *Save as PDF* from there). | ☐ | ☐ |
| 17 | **Offline** | Turn on airplane mode, open Slay. | It opens, shows the "Offline" strip and recently viewed orders/stock; saving shows "you're offline". | ☐ | ☐ |
| 18 | **Camera for bills/photos** | *More → Supplier bills → Snap a supplier bill*. | Camera opens; photo saves with the time. | ☐ | ☐ |
| 19 | **Return / refund (optional feature)** | On a test order that was paid: *Return / exchange → Return*, + one piece, *Give money back now*, Save. Then on another test order: *Cancel order*, switch off *Put the pieces back in stock*. | Order shows *Returned* and the refund under Payments; the other phone gets a "recorded a refund" notification; stock is unchanged for the made-to-order piece. | ☐ | ☐ |

Everything else (products, categories, stock counts, orders with per-piece sizes, payments, platform,
search, dashboard totals, supplier-bill types, cancel / return / exchange / refund) was tested end to end in a real browser against the real
server before release; quickly repeat a couple of them on the phone to be sure (e.g. one order).
