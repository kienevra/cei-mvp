$base = "http://127.0.0.1:8000/api/v1"

# 1) Owner login
$ownerEmail = "leon@cei.local"
$ownerPass  = "mypassword"

$ownerTok = (curl.exe -s -X POST "$base/auth/login" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data "username=$ownerEmail&password=$ownerPass" | ConvertFrom-Json).access_token

if (-not $ownerTok) { throw "Owner login failed (no token)" }

# 2) Create invite
$inviteEmail = ("invite_" + [guid]::NewGuid().ToString("N").Substring(0,8) + "@cei.local")
$tmp = Join-Path $env:TEMP "cei_inv_create.json"
@{ email = $inviteEmail; role="member"; expires_in_days=7 } | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding utf8

$inv = curl.exe -s -X POST "$base/org/invites" `
  -H "Authorization: Bearer $ownerTok" `
  -H "Content-Type: application/json" `
  --data-binary "@$tmp" | ConvertFrom-Json

if (-not $inv.id) { throw "Invite create failed (no id)" }
if (-not $inv.token) { throw "Invite create failed (no token returned)" }

# 3) Accept-and-signup (public)
$tmp2 = Join-Path $env:TEMP "cei_inv_accept.json"
$pw = "TempPass123!"
@{ token=$inv.token; email=$inviteEmail; password=$pw; full_name="Invited User" } | ConvertTo-Json | Set-Content -LiteralPath $tmp2 -Encoding utf8

$accepted = curl.exe -s -X POST "$base/org/invites/accept-and-signup" `
  -H "Content-Type: application/json" `
  --data-binary "@$tmp2" | ConvertFrom-Json

if (-not $accepted.access_token) { throw "Accept failed (no access_token)" }

# 4) Use returned token to call /account/me
$me = curl.exe -s "$base/account/me" -H "Authorization: Bearer $($accepted.access_token)" | ConvertFrom-Json
"OK: invited user created -> id=$($me.id) email=$($me.email) role=$($me.role)"


#to run it in powershell
#powershell -ExecutionPolicy Bypass -File .\scripts\test_invite_happy_path.ps1

