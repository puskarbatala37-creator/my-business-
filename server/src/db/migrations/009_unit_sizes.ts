export default /* sql */ `
-- An order line with several pieces of the same product can have a different size for each piece
-- (e.g. two kurtas, sizes 42 and 41). JSON array, one size per piece; NULL when all pieces share \`size\`.
ALTER TABLE order_items ADD COLUMN unit_sizes TEXT;
`;
