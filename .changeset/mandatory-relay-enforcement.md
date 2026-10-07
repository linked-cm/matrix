---
'@linked.cm/matrix': minor
---

Add a fail-closed relay enforcement seam for hosts with mandatory safety or
policy controls. Server-issued sessions can attest an active policy, clients can
require it, moderated room power levels prevent direct member events, and a
framework-neutral controlled-send handler derives identity from the verified
session before authorization, control evaluation, logical-author stamping, and
relay dispatch.
