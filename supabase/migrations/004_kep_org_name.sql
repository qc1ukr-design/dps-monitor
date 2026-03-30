-- Migration: Add kep_org_name to api_tokens
-- Stores the organisation name from the certificate (populated for ЮО director certs)

alter table api_tokens
  add column if not exists kep_org_name text;
