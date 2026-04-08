-- Rename subscription tiers from 'free'/'pro' to 'player'/'player_plus'
-- Roles (student, teacher, admin) are unchanged.

-- 1. Migrate existing data
update public.profiles set subscription_tier = 'player'      where subscription_tier = 'free';
update public.profiles set subscription_tier = 'player_plus' where subscription_tier = 'pro';

-- 2. Update column default
alter table public.profiles alter column subscription_tier set default 'player';

-- 3. Update column comment
comment on column public.profiles.subscription_tier is
  'Billing tier: player (free), player_plus (paid individual), teacher (paid with classroom access)';
