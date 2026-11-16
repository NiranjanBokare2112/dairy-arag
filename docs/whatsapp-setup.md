# WhatsApp setup (Meta WhatsApp Cloud API)

The center sends WhatsApp messages from its own Meta account, with no paid middleman. The server code is in `backend/app/whatsapp.py`.

## Stage 1: test with Meta's free test number (no business verification needed)

1. Go to **developers.facebook.com** and log in with the owner's Facebook account. Choose **My Apps → Create app → Other → Business**. Name it "Arag Dudh", link it to the center's business portfolio (create one if asked), then add the product **WhatsApp**.
2. Open **WhatsApp → API Setup**. Meta gives a free **test phone number** that can message up to 5 numbers you add there.
   - Under "To", add your own mobile number and confirm the code Meta sends you.
   - Copy the **Phone number ID** and the **WhatsApp Business Account ID** shown on that page.
3. Create a **permanent access token** (the token on the API Setup page expires after 24 hours):
   **Business settings → Users → System users → Add** (name "arag-server", role Admin) → **Add assets** (the app, full control; the WhatsApp account, full control) → **Generate token**. Choose the app and the permissions `whatsapp_business_messaging` and `whatsapp_business_management`, with no expiry.
4. Copy the **App secret** from **App settings → Basic**.
5. Fill these in **`.env`** on the desktop yourself. Never paste the token or the app secret into chat, email or WhatsApp.
   ```
   WHATSAPP_PHONE_NUMBER_ID=...        (step 2)
   WHATSAPP_BUSINESS_ACCOUNT_ID=...    (step 2)
   WHATSAPP_ACCESS_TOKEN=...           (step 3, secret)
   WHATSAPP_APP_SECRET=...             (step 4, secret)
   WHATSAPP_VERIFY_TOKEN=...           (make up any long random word; used again in Stage 3)
   WHATSAPP_ALLOWED_NUMBERS=9xxxxxxxxx (your own number(s), comma separated)
   WHATSAPP_LIVE=0
   ```
6. Check the setup and send yourself Meta's ready-made test message:
   ```
   cd backend
   python -m app.cli wa-check
   python -m app.cli wa-test 9xxxxxxxxx
   ```
   "Hello World" should arrive on your phone.

## Stage 2: the center's Marathi templates

```
python -m app.cli wa-templates --submit     # sends milk_entry_mr_v1, milk_correction_mr_v1, center_notice_mr_v1 for approval
python -m app.cli wa-templates              # approval status (APPROVED / PENDING / REJECTED)
```

Approval usually takes minutes to a day. Once they are APPROVED, try the real messages on your own number:
```
python -m app.cli wa-send --dry-run         # shows what would be sent, sends nothing
python -m app.cli wa-send                   # sends due messages, only to WHATSAPP_ALLOWED_NUMBERS
```

## Stage 3: delivery reports (needs the Cloudflare Tunnel)

Meta reports "delivered / read / failed" by calling `https://<your-domain>/api/whatsapp/webhook`.

- In the app: **WhatsApp → Configuration → Webhook**. Set the callback URL above and the same verify token as in `.env`, then subscribe to **messages**.
- **Expose only this one path through the tunnel.** The other API paths are not protected by a login yet.
- Until this is in place, messages show as "sent" (Meta accepted them), but not yet as "delivered".

## Stage 4: go live with the center's own number

1. Add the center's business number in WhatsApp Manager. Set the display name "आरग दूध संकलन केंद्र", upload the logo, and verify the number by OTP.
2. Complete **business verification** (Udyam / GST / Shop Act, plus an address proof), and add a **payment method** in WhatsApp Manager.
3. Put the new Phone number ID in `.env` and run `wa-check`. The templates belong to the business account, so they stay approved.
4. Make sure the real farmer list is in the database, with mobiles and the consent tick. Then set **`WHATSAPP_LIVE=1`**.

## Safety rules built in

- While `WHATSAPP_LIVE=0`, nothing goes to any number outside `WHATSAPP_ALLOWED_NUMBERS`. The demo farmers' made-up mobiles may belong to real people.
- Figures are read from the saved entry at the moment of sending; nothing is typed or generated.
- An expired token or an unapproved template stops the run without using up the farmers' retries.
- No internet: messages wait in the outbox.
- A farmer who isn't on WhatsApp gets the message by SMS, except notices for which the owner did not allow SMS.
- Delivery reports are accepted only with Meta's signature (`WHATSAPP_APP_SECRET`).
