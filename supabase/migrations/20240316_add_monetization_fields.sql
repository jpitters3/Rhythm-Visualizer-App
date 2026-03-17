-- Add monetization fields to profiles table
alter table public.profiles 
add column if not exists subscription_tier text default 'free',
add column if not exists stripe_customer_id text,
add column if not exists subscription_status text;

-- Optional: Create a trigger to ensure every profile has a default tier
-- (Though the default 'free' handles this, this ensures consistency)
comment on column public.profiles.subscription_tier is 'The tier of the user subscription, e.g., free, pro';
comment on column public.profiles.stripe_customer_id is 'The Stripe customer ID for billing management';
comment on column public.profiles.subscription_status is 'The status of the Stripe subscription, e.g., active, trailing, canceled';
