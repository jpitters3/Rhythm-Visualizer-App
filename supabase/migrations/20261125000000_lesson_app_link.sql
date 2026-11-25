-- A lesson can point at a Panafide game or page: 'game:<id>', 'page:<route>',
-- or a Panafide URL. The lesson player shows it as a button (js/app-links.js).
alter table public.lessons add column if not exists app_link text;
