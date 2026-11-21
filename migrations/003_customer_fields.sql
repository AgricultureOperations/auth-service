-- 003_customer_fields: customer data on users. Orders reference buyers that are auth-service users with the
-- `customer` role. Nullable columns only (additive), so the previous image keeps working against this schema.

ALTER TABLE users ADD COLUMN tax_id TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX users_tax_id_unique ON users (tax_id) WHERE tax_id IS NOT NULL;
