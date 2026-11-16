-- Farmer details — the same figures the farmer page (#/my, GET /api/farmer/me) shows.
-- Change 101 to the farmer code you want. Amounts in ₹, litres, Fat/SNF as decimals.
-- Run: psql -h localhost -U arag_app -d arag_dudh_test -f farmer-details.sql   (sample data is in the TEST database)

-- 1. Profile
SELECT code, name, village, mobile, has_whatsapp, milk_cow, milk_buffalo, upi_id,
       CASE WHEN aadhaar_last4 <> '' THEN 'XXXX XXXX ' || aadhaar_last4 ELSE '' END AS aadhaar, active
FROM farmers WHERE code = 101;

-- 2. Today's milk (each pour)
SELECT c.shift, c.milk_type, round(c.litres_x100 / 100.0, 2) AS litres, round(c.fat_x10 / 10.0, 1) AS fat, round(c.snf_x10 / 10.0, 1) AS snf,
       round(c.rate_paise / 100.0, 2) AS rate_rs, round(c.amount_paise / 100.0, 2) AS amount_rs
FROM collections c JOIN farmers f ON f.id = c.farmer_id
WHERE f.code = 101 AND NOT c.void AND c.date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY c.shift DESC, c.milk_type;

-- 3. Last 10 days of entries
SELECT c.date, c.shift, c.milk_type, round(c.litres_x100 / 100.0, 2) AS litres, round(c.fat_x10 / 10.0, 1) AS fat, round(c.snf_x10 / 10.0, 1) AS snf,
       round(c.rate_paise / 100.0, 2) AS rate_rs, round(c.amount_paise / 100.0, 2) AS amount_rs
FROM collections c JOIN farmers f ON f.id = c.farmer_id
WHERE f.code = 101 AND NOT c.void AND c.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 9
ORDER BY c.date DESC, c.shift DESC;

-- 4. Last 30 days summary (Fat/SNF weighted by litres)
SELECT count(DISTINCT c.date)                                         AS milk_days,
       round(sum(c.litres_x100) / 100.0, 2)                          AS total_litres,
       round(sum(c.litres_x100) / 100.0 / nullif(count(DISTINCT c.date), 0), 2) AS avg_litres_per_day,
       round(sum(c.fat_x10 * c.litres_x100)::numeric / sum(c.litres_x100) / 10, 2) AS avg_fat,
       round(sum(c.snf_x10 * c.litres_x100)::numeric / sum(c.litres_x100) / 10, 2) AS avg_snf,
       round(sum(c.amount_paise) / 100.0, 2)                         AS amount_rs
FROM collections c JOIN farmers f ON f.id = c.farmer_id
WHERE f.code = 101 AND NOT c.void AND c.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 29;

-- 5. Bills (latest 7) with payment status
SELECT b.bill_no, b.start_date, b.end_date, round(b.litres_x100 / 100.0, 2) AS litres, round(b.avg_fat_x100 / 100.0, 2) AS avg_fat,
       round(b.gross_paise / 100.0, 2) AS milk_rs, round(b.total_deduct_paise / 100.0, 2) AS deductions_rs,
       round(b.payable_paise / 100.0, 2) AS payable_rs, round(b.paid_paise / 100.0, 2) AS paid_rs,
       CASE WHEN b.status <> 'final' THEN 'draft'
            WHEN b.payable_paise = 0 THEN 'nothing due'
            WHEN b.paid_paise >= b.payable_paise THEN 'paid'
            WHEN b.paid_paise > 0 THEN 'part paid' ELSE 'unpaid' END AS payment_status
FROM bills b JOIN farmers f ON f.id = b.farmer_id
WHERE f.code = 101 ORDER BY b.start_date DESC LIMIT 7;

-- 6. Payments received
SELECT p.date, p.mode, round(p.amount_paise / 100.0, 2) AS amount_rs, p.upi_ref, b.bill_no
FROM payments p JOIN bills b ON b.id = p.bill_id JOIN farmers f ON f.id = p.farmer_id
WHERE f.code = 101 AND NOT p.void ORDER BY p.date DESC;

-- 7. Balances: advance still to recover, feed not yet billed, unpaid bills
SELECT
  ((coalesce((SELECT sum(a.amount_paise) FROM advances a WHERE a.farmer_id = f.id), 0)
   - coalesce((SELECT sum(r.amount_paise) FROM advance_recoveries r JOIN bills b ON b.id = r.bill_id
               WHERE b.farmer_id = f.id AND b.status = 'final'), 0)) / 100.0)::numeric(12,2)                   AS advance_outstanding_rs,
  (coalesce((SELECT sum(m.amount_paise) FROM feed_moves m
            WHERE m.farmer_id = f.id AND m.type = 'sale' AND m.bill_id IS NULL), 0) / 100.0)::numeric(12,2) AS feed_unbilled_rs,
  (coalesce((SELECT sum(b.payable_paise - b.paid_paise) FROM bills b
            WHERE b.farmer_id = f.id AND b.status = 'final'), 0) / 100.0)::numeric(12,2)                 AS unpaid_bills_rs
FROM farmers f WHERE f.code = 101;

-- 8. Farmer logins (who logged in as this farmer, and wrong codes tried)
SELECT at, action, after_json ->> 'code' AS code, ip
FROM audit_log WHERE entity = 'farmer' AND (farmer_id = (SELECT id FROM farmers WHERE code = 101) OR action = 'farmer-login-failed')
ORDER BY at DESC LIMIT 20;
