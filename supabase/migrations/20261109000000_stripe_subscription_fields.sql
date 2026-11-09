-- Lets cancel/pause target the exact Stripe subscription, and the app show
-- "Paused until ...".
alter table public.profiles
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_resumes_at timestamptz;

comment on column public.profiles.subscription_status is
  'active, canceling (ends at subscription_expires_at), paused (until subscription_resumes_at), canceled, inactive';
