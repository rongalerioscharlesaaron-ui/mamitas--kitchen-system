-- Development only: moves the sample batches (B-0001 to B-0016) back to their original
-- dates relative to today, so the sample stock is fresh again. Safe to run any time.
UPDATE inventory_batches b
   SET received_date = CURRENT_DATE + v.received_off,
       expiry_date   = CASE WHEN v.expiry_off IS NULL THEN NULL ELSE CURRENT_DATE + v.expiry_off END
  FROM (VALUES
    ('B-0001', -10, NULL), ('B-0002', -20, 120), ('B-0003', -2, 2),  ('B-0004', -8, -1),
    ('B-0005', -6, 1),     ('B-0006', -30, 200), ('B-0007', -1, 1),  ('B-0008', -1, 2),
    ('B-0009', 0, 1),      ('B-0010', 0, 1),     ('B-0011', 0, 1),   ('B-0012', 0, 1),
    ('B-0013', -1, 3),     ('B-0014', -15, NULL), ('B-0015', -12, NULL), ('B-0016', -1, 4)
  ) AS v(code, received_off, expiry_off)
 WHERE b.batch_code = v.code;