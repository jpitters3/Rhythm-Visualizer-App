-- Allow reading patterns that are referenced by a shared composition.
-- A composition is "shared" if it has a non-null share_token.
CREATE POLICY "patterns_shared_read" ON public.patterns
  FOR SELECT TO anon, authenticated
  USING (
    name IN (
      SELECT cs.phrase_name
      FROM public.composition_sections cs
      JOIN public.compositions c ON c.id = cs.composition_id
      WHERE c.share_token IS NOT NULL
        AND cs.phrase_name IS NOT NULL
    )
  );
