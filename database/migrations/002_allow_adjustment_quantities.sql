-- Stock adjustments can go up or down, so an ADJUSTMENT quantity is signed
-- (positive = found more than the system showed, negative = found less).
-- Every other movement type must still be positive.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_qty_check;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_qty_rule;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty_rule CHECK (
    (movement_type = 'ADJUSTMENT' AND qty <> 0)
    OR (movement_type <> 'ADJUSTMENT' AND qty > 0)
);