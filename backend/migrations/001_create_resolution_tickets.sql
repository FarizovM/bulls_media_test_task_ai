CREATE TABLE IF NOT EXISTS resolution_tickets (
  ticket_id varchar(80) PRIMARY KEY,
  order_id varchar(50) NOT NULL,
  status text NOT NULL CHECK (status IN (
    'APPROVED_AUTO_REFUND',
    'REJECTED_BY_POLICY',
    'ESCALATED_TO_HUMAN'
  )),
  refund_amount_usd numeric(12, 2) CHECK (refund_amount_usd IS NULL OR refund_amount_usd <= 100000000),
  reason_code text NOT NULL CHECK (reason_code IN (
    'RETURN_WINDOW_EXPIRED',
    'ACTIVATION_FAILURE_REQUIRES_VERIFICATION',
    'NON_REFUNDABLE_CATEGORY',
    'AUTO_APPROVAL_AMOUNT_LIMIT',
    'REFUND_WITHIN_POLICY',
    'MANUAL_REVIEW_REQUESTED'
  )),
  deterministic_override_applied boolean NOT NULL,
  note text NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  actor_subject varchar(255) NOT NULL,
  policy_version varchar(40) NOT NULL,
  CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'APPROVED_AUTO_REFUND' AND refund_amount_usd IS NOT NULL AND refund_amount_usd >= 0)
    OR (status <> 'APPROVED_AUTO_REFUND' AND refund_amount_usd IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS orders (
  order_id varchar(50) PRIMARY KEY CHECK (order_id = upper(order_id)),
  customer_name varchar(200) NOT NULL,
  item_name varchar(300) NOT NULL,
  category varchar(100) NOT NULL,
  total_amount_usd numeric(12, 2) NOT NULL CHECK (total_amount_usd >= 0 AND total_amount_usd <= 100000000),
  purchased_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resolution_tickets_order_created_idx
  ON resolution_tickets (order_id, created_at DESC);
