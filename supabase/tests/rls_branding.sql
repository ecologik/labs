-- Tests for 0008 branding.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);

-- staff can't
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  begin
    perform public.admin_set_branding(current_setting('test.bella')::uuid, 'Hacked', '{}');
    raise exception 'FAIL: staff changed branding';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- admin can; other settings survive; bad input refused
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare t uuid := current_setting('test.bella')::uuid; out jsonb; stages jsonb;
begin
  select settings -> 'sales_stages' into stages from public.tenants where id = t;
  out := public.admin_set_branding(t, '  My Bella Vita  ',
    '{"logo":"data:image/png;base64,iVBORw0KGgo=","colors":{"primary":"#9c3d54","dark":"#7e2f43","tint":"#f7ebee"}}');
  assert out ->> 'name' = 'My Bella Vita', 'name trimmed and saved';
  assert (select settings -> 'branding' -> 'colors' ->> 'primary' from public.tenants where id = t) = '#9c3d54', 'color saved';
  assert (select settings -> 'sales_stages' from public.tenants where id = t) = stages, 'other settings kept';
  begin perform public.admin_set_branding(t, 'X', '{"colors":{"primary":"red; background:url(x)"}}'); raise exception 'FAIL: bad color';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.admin_set_branding(t, 'X', '{"logo":"javascript:alert(1)"}'); raise exception 'FAIL: bad logo';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.admin_set_branding(t, '  ', '{}'); raise exception 'FAIL: blank name';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- logo only: kept with a logo, dropped without one, must be boolean
  perform public.admin_set_branding(t, 'My Bella Vita', '{"logo":"data:image/png;base64,iVBORw0KGgo=","logo_only":true}');
  assert (select settings -> 'branding' -> 'logo_only' from public.tenants where id = t) = 'true'::jsonb, 'logo_only saved';
  perform public.admin_set_branding(t, 'My Bella Vita', '{"logo_only":true}');
  assert not (select settings -> 'branding' ? 'logo_only' from public.tenants where id = t), 'logo_only needs a logo';
  begin perform public.admin_set_branding(t, 'X', '{"logo_only":"yes"}'); raise exception 'FAIL: bad logo_only';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- fonts: saved as keys; anything else refused
  perform public.admin_set_branding(t, 'My Bella Vita', '{"fonts":{"heading":"playfair-display","body":"inter"}}');
  assert (select settings -> 'branding' -> 'fonts' ->> 'heading' from public.tenants where id = t) = 'playfair-display', 'fonts saved';
  begin perform public.admin_set_branding(t, 'X', '{"fonts":{"body":"Inter; } body{display:none"}}'); raise exception 'FAIL: bad font';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.admin_set_branding(t, 'X', '{"fonts":{"title":"inter"}}'); raise exception 'FAIL: bad font slot';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- clearing the logo
  perform public.admin_set_branding(t, 'My Bella Vita', '{"colors":{"primary":"#9c3d54"}}');
  assert not (select settings -> 'branding' ? 'logo' from public.tenants where id = t), 'logo removed';
end $$;
reset role;
\echo ALL BRANDING TESTS PASSED
