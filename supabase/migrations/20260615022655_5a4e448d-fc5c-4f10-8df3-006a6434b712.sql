ALTER TABLE public.leads ADD COLUMN imported_by uuid NULL;
CREATE INDEX leads_imported_by_idx ON public.leads (imported_by) WHERE imported_by IS NOT NULL;
DROP POLICY IF EXISTS "Authenticated can read leads" ON public.leads;
CREATE POLICY "Authenticated can read catalog and own imports"
ON public.leads
FOR SELECT
TO authenticated
USING (imported_by IS NULL OR imported_by = auth.uid());