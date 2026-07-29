alter table if exists public.company_settings
  add column if not exists company_activity text not null
  default 'Importateur et Distributeur de Piece de Rechange de Poids Lourd';

update public.company_settings
set company_activity = 'Importateur et Distributeur de Piece de Rechange de Poids Lourd'
where company_activity is null or btrim(company_activity) = '';
