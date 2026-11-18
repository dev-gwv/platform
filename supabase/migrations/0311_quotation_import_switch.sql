-- 0311: Upload a quotation, and the project makes itself (owner, 18 Nov).
--
-- The owner asked for this to be live in one studio first: the one their own
-- test login (afreenekram98@gmail.com) owns. No "try new features" switch on
-- screen -- the button simply appears on Projects for a studio that has it.
-- `companies.quote_import` is that switch; a later migration turns it on for
-- everyone, or the platform owner flips it for one studio.
--
-- Safe to run twice.

alter table companies add column if not exists quote_import boolean not null default false;

-- The studio's own Google Forms and the WhatsApp message that goes with each,
-- written into the tasks the upload gives the manager:
--   {"e_invite": {"form": url, "reference": url, "message": text},
--    "event_timeline": {"form": url, "message": text}}
-- Null: the tasks still say what to send, without a link.
alter table companies add column if not exists quote_import_forms jsonb;

-- The studio that login owns or runs (its own profile, or a profile linked to
-- the same login). The login's email only: a studio profile's email can be
-- anything a studio typed for a team member.
update companies c
   set quote_import = true,
       quote_import_forms = coalesce(c.quote_import_forms, jsonb_build_object(
         'e_invite', jsonb_build_object(
           'form', 'https://docs.google.com/forms/d/e/1FAIpQLSfW2MGd7aSYfo8zDJg3dhj70sXEHFMOUlnriVzFhhOUfQo3xA/viewform?usp=sf_link',
           'reference', 'https://drive.google.com/drive/folders/1DFstaS_H5eL0s7ok9AiI7mRRdfSlIZVo?usp=sharing',
           'message', E'Hello\U0001F90D\n\nAs we prepare for your upcoming event, we''d like to gather the necessary details to design your invitation. Please fill out the form at the link below.\n\nForm link: {form}\n\nReference link: {reference}\n\nThank you\U0001F33A'),
         'event_timeline', jsonb_build_object(
           'form', 'https://docs.google.com/forms/d/e/1FAIpQLScSE8yE6kNjrhShuTBMmI2kx3VMbQyA6Y3YAbNg4zk1OFKx5Q/viewform?usp=sf_link',
           'message', E'Helloo\U0001F90D\n\nHope you are doing great! I have attached a form with this message. Please help us by filling this form with details like locations and the timings. Your input will help us reach each location on time and ensure every moment aligns with your vision.\n\n{form}\n\nThank You\u2728 We look forward to your valuable input')))
  from users u
  join auth.users au on au.id = auth_identity_of(u.user_id)
 where u.company_id = c.id
   and u.deleted_at is null
   and (u.user_id = c.owner_user_id or u.role in ('super_admin', 'admin'))
   and lower(trim(au.email)) = 'afreenekram98@gmail.com';

-- Who does what in that studio (owner, 18 Nov), as job roles, so the upload's
-- tasks find them: Sorav admin, Mohit photo editor, Usman and Aman teasers,
-- films and reels, Rayeen full-length films and reels, Sudhansu project
-- manager, and Sorav and Mohit design the e-invites, save-the-dates and
-- countdowns. Each role is made once; each is given to the studio's person whose
-- first name it is (a person not added yet picks it when added). Never taken
-- away from anyone, so the studio can change it in Team -> Roles.
do $$
declare
  v_company uuid;
  r record;
  v_role uuid;
begin
  for v_company in select id from companies where quote_import loop
    for r in
      select * from (values
        ('Admin',                      'admin_data',         'other', array['sorav', 'saurav']),
        ('Photo Editor',               'photo_editor',       'post',  array['mohit']),
        ('Teaser, Film & Reel Editor', 'teaser_film_reel_editor', 'post', array['usman', 'aman']),
        ('Full-length & Reel Editor',  'full_length_reel_editor', 'post', array['rayeen', 'rayyan']),
        ('Project Manager',            'project_manager',    'other', array['sudhansu', 'sudhanshu']),
        ('Invite & Countdown Designer', 'invite_countdown_designer', 'post', array['sorav', 'saurav', 'mohit'])
      ) as t(type_name, role_code, stage, first_names)
    loop
      select id into v_role from employee_roles
       where company_id = v_company and (role_code = r.role_code or lower(btrim(type_name)) = lower(r.type_name))
       limit 1;
      if v_role is null then
        insert into employee_roles (company_id, type_name, role_code, stage)
        values (v_company, r.type_name, r.role_code, r.stage)
        returning id into v_role;
      end if;
      insert into employee_role_assignments (user_id, role_id, company_id)
      select u.user_id, v_role, v_company
        from users u
       where u.company_id = v_company and u.deleted_at is null
         and lower(split_part(btrim(u.name), ' ', 1)) = any (r.first_names)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
