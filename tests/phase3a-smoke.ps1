# Start `npm run dev` in another PowerShell window first.
# The requests here are UNAUTHORIZED, so they cannot insert database records.
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
function Get-Status([string]$url, [string]$method, [hashtable]$headers, [string]$body) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method $method -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 15
        return [int]$response.StatusCode
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        throw
    }
}
$testResponse = Invoke-WebRequest -Uri "$base/__proxy_test" -UseBasicParsing -TimeoutSec 15
if ($testResponse.StatusCode -ne 200 -or $testResponse.Content -notmatch 'PROXY OK') {
    throw 'Proxy sanity check failed'
}
$payload = '{"path":"/probe","method":"GET","action":"ALLOW"}'
$noSecret = Get-Status "$base/api/security/log" 'POST' @{ 'Content-Type'='application/json' } $payload
$badSecret = Get-Status "$base/api/security/log" 'POST' @{ 'Content-Type'='application/json'; 'x-internal-secret'='deliberately-invalid' } $payload
if ($noSecret -ne 401) { throw "Expected HTTP 401 without a token, got $noSecret (check INTERNAL_TELEMETRY_SECRET)" }
if ($badSecret -ne 401) { throw "Expected HTTP 401 with an invalid token, got $badSecret" }
Write-Host 'PHASE 3A UNAUTHORIZED-REQUEST SMOKE TEST: PASS' -ForegroundColor Green
Write-Host 'Note: this does NOT verify authorized insertion, subscription billing, or deployment configuration.'