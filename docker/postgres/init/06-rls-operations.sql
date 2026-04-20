-- RLS policies for operations + accounting tables

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','warehouses','customers','items',
    'chart_of_accounts','tax_codes','fiscal_periods'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t, t
    );
  END LOOP;
END$$;
