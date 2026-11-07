# Backend — not started

Will hold the API server running on the center's Windows desktop, the database (every business table carries `center_id`), the rate lookup and billing engine (money in integer paise), audit logging, Marathi PDF bill generation, and the messaging workers that drain the outbox to the WhatsApp Cloud API and the LAN SMS gateway with retries and the daily SMS cap.
