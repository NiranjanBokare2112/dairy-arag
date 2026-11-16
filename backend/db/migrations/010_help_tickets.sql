-- 010 — Help / support tickets (D-109). Owner, operators and farmers report an issue; Bokare support is told by
-- email + WhatsApp (ticket_notifications, sent by the backend) and answers from its own login (role 'support');
-- a farmer hears about a reply by WhatsApp / SMS (outbox kind 'support').
-- Apply:  python -m app.cli migrate

-- Bokare support login
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'operator', 'support'));

CREATE TABLE IF NOT EXISTS public.tickets (
    id                 text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    center_id          text NOT NULL REFERENCES public.centers(id),
    no                 text NOT NULL CHECK (no ~ '^T-[0-9]{4,}$'),
    reporter_kind      text NOT NULL CHECK (reporter_kind IN ('owner', 'operator', 'farmer')),
    reporter_user_id   text REFERENCES public.users(id),
    reporter_farmer_id text REFERENCES public.farmers(id),
    reporter_name      text NOT NULL,
    category           text NOT NULL CHECK (category IN ('milk', 'bill', 'upi', 'app', 'login', 'other')),
    priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
    subject            text NOT NULL CHECK (btrim(subject) <> '' AND char_length(subject) <= 120),
    status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'waiting', 'resolved', 'closed')),
    unread_for         text[] NOT NULL DEFAULT '{}',          -- who has a reply they have not opened yet
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK ((reporter_kind = 'farmer') = (reporter_farmer_id IS NOT NULL)),
    CHECK ((reporter_kind = 'farmer') = (reporter_user_id IS NULL)),
    UNIQUE (center_id, no)
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON public.tickets (center_id, status, updated_at);

-- the conversation: a message, or a status change
CREATE TABLE IF NOT EXISTS public.ticket_messages (
    id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    ticket_id   text NOT NULL REFERENCES public.tickets(id),
    author_kind text NOT NULL CHECK (author_kind IN ('owner', 'operator', 'farmer', 'support')),
    author_name text NOT NULL,
    text        text CHECK (text IS NULL OR (btrim(text) <> '' AND char_length(text) <= 2000)),
    status      text CHECK (status IS NULL OR status IN ('open', 'in-progress', 'waiting', 'resolved', 'closed')),
    at          timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(text, status) = 1)
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON public.ticket_messages (ticket_id, at);

-- what Bokare support must be told (email to SUPPORT_EMAIL, WhatsApp to SUPPORT_WHATSAPP from .env)
CREATE TABLE IF NOT EXISTS public.ticket_notifications (
    id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    ticket_id   text NOT NULL REFERENCES public.tickets(id),
    channel     text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    event       text NOT NULL CHECK (event IN ('created', 'reply')),
    status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
    attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    sent_at     timestamptz,
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ticket_notifications_queue_idx ON public.ticket_notifications (status, created_at) WHERE status = 'queued';

-- a reply to a farmer's ticket is told to the farmer by WhatsApp / SMS
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS ticket_id text REFERENCES public.tickets(id);
ALTER TABLE public.outbox_messages ADD COLUMN IF NOT EXISTS ticket_message_id text REFERENCES public.ticket_messages(id);
-- one message per reply (a farmer may get several replies a day)
DROP INDEX IF EXISTS public.outbox_no_double_uq;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_no_double_uq ON public.outbox_messages (center_id, farmer_id, kind, date,
    COALESCE(bill_id, ''), COALESCE(payment_id, ''), COALESCE(collection_id, ''), COALESCE(correction_id, ''), COALESCE(broadcast_id, ''),
    COALESCE(ticket_message_id, ''));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_kind_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_kind_check
    CHECK (kind IN ('daily', 'bill', 'payment', 'payment-corrected', 'pour', 'pour-fix', 'notice', 'support'));
ALTER TABLE public.outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_support_ref_check;
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_messages_support_ref_check CHECK (kind <> 'support' OR (ticket_id IS NOT NULL AND ticket_message_id IS NOT NULL));
