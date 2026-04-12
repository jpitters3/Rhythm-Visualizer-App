-- Add share_token to compositions for shareable links.
-- A composition with a share_token set is readable by anyone who knows the token.

ALTER TABLE public.compositions
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

-- Allow anyone (including anonymous) to read a shared composition by token.
-- The token itself is the secret — unguessable without the link.
CREATE POLICY "compositions_shared_read"
  ON public.compositions FOR SELECT
  TO anon, authenticated
  USING (share_token IS NOT NULL);

-- Allow anyone to read sections of a shared composition.
CREATE POLICY "composition_sections_shared_read"
  ON public.composition_sections FOR SELECT
  TO anon, authenticated
  USING (
    composition_id IN (
      SELECT id FROM public.compositions WHERE share_token IS NOT NULL
    )
  );
