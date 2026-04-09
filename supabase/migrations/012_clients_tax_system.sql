-- Add tax_system to clients table
-- 'simplified' = ФОП on unified/simplified tax (default, existing behavior)
-- 'general'    = ФОП on general tax system
alter table clients
  add column if not exists tax_system text
    not null default 'simplified'
    check (tax_system in ('simplified', 'general'));
