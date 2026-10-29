# Advantage privacy and granted scopes

NRPS members may omit profile attributes, including `name`. The SDK preserves
that absence; use `getLtiMemberDisplayName` when a UI needs a label. It can display
the available name parts, email or opaque user ID without fabricating roster data.
See [NRPS 2.0, sharing personal data](https://www.imsglobal.org/spec/lti-nrps/v2p0/).

For AGS, the `lineitem` scope permits GET as well as write operations.
`lineitem.readonly` permits GET only. A read uses the read-only scope when granted,
otherwise it uses the granted full scope. Read-only permission never permits a
write, score publication or result access. See [AGS 2.0, scopes and HTTP methods](https://www.imsglobal.org/spec/lti-ags/v2p0/).

The raw AGS transport retains explicitly requested scopes when there is no
matching launch declaration; the platform token endpoint remains authoritative.
The high-level Advantage API checks the declared capabilities before calling it.
