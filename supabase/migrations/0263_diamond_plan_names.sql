-- 0263: the IPC Diamond plans say so in their names (owner, 14 Oct).
--
-- Plan & billing and the home page now show both price lists to everyone,
-- the regular one on top and the members' below it: "Diamond Starter",
-- "Diamond Pro" and "Diamond Studio Max" -- the same plans, the same
-- features, about half the price. The name rides into the WhatsApp message,
-- payment history, the sidebar plan card and Studio Access Manager.
update plans
   set name = 'Diamond ' || name, updated_at = now()
 where audience = 'diamond'
   and tier is not null
   and name not like 'Diamond %';
