export default /* sql */ `
-- Optional stitching measurements for an order line, one value per measurement (never combined):
-- JSON like {"bust":"34","waist":"28.5","pant_length":"40"} – keys from MEASUREMENTS in @slay/shared.
-- NULL when the line has no measurements (the size alone is used, as before).
ALTER TABLE order_items ADD COLUMN measurements TEXT;
`;
