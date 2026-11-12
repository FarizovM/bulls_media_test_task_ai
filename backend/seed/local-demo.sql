INSERT INTO orders (order_id, customer_name, item_name, category, total_amount_usd, purchased_at)
VALUES
  ('ORD-1001', 'Alex Morgan', 'Набір керамічних чашок', 'Дім і кухня', 45, now() - interval '3 days'),
  ('ORD-1002', 'Jamie Lee', 'Робочий ноутбук', 'Електроніка', 1200, now() - interval '5 days'),
  ('ORD-1003', 'Taylor Reed', 'Кросівки для бігу', 'Одяг', 80, now() - interval '45 days'),
  ('ORD-1004', 'Jordan Kim', 'Цифрова подарункова картка', 'Цифрова подарункова картка', 25, now() - interval '2 days'),
  ('ORD-1005', 'Sam Patel', 'Настільна лампа', 'Дім і кухня', 72, now() - interval '8 days')
ON CONFLICT (order_id) DO NOTHING;
