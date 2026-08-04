<#
    serve.ps1 -- a static file server in ~90 lines of PowerShell.

    ES modules will not load over file://, and this machine has no Node or
    Python, so this stands in for `npx serve`. It is a development convenience
    only: localhost, no TLS, no compression, single-threaded.

    Usage:
        powershell -ExecutionPolicy Bypass -File tools\serve.ps1
        powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 9000

    Stop it with Ctrl+C.

    ASCII only on purpose: PowerShell 5.1 reads .ps1 as ANSI unless the file
    has a BOM, so a stray em dash here becomes a parse error.
#>

[CmdletBinding()]
param(
    [int]$Port = 8181,
    [string]$Root
)

$ErrorActionPreference = "Stop"

# Resolved here rather than as a param default: when the script is launched with
# a relative path (powershell -File tools\serve.ps1), $PSScriptRoot is still
# empty during parameter binding and the default blows up.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = (Resolve-Path (Join-Path $scriptDir "..")).Path }

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".webp" = "image/webp"
    ".ico"  = "image/x-icon"
    ".woff2" = "font/woff2"
    ".txt"  = "text/plain; charset=utf-8"
    ".md"   = "text/markdown; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
}
catch {
    Write-Host "Could not bind to port $Port." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Try another port:  -Port 9000" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  Workout Companion" -ForegroundColor Cyan
Write-Host "  serving $Root"
Write-Host "  http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Ctrl+C to stop"
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart("/")
            if ($relative -eq "") { $relative = "index.html" }

            $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

            # Refuse anything that resolves outside the project root.
            if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
            }
            elseif (Test-Path $full -PathType Leaf) {
                $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
                $response.ContentType = $MimeTypes[$extension]
                if (-not $response.ContentType) { $response.ContentType = "application/octet-stream" }

                # No caching, so an edit shows up on refresh.
                $response.Headers.Add("Cache-Control", "no-store, must-revalidate")
                $response.StatusCode = 200
                $body = [System.IO.File]::ReadAllBytes($full)
            }
            else {
                $response.StatusCode = 404
                $response.ContentType = "text/plain; charset=utf-8"
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: /$relative")
            }

            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)

            $colour = if ($response.StatusCode -eq 200) { "DarkGray" } else { "Yellow" }
            Write-Host ("  {0}  {1}  /{2}" -f $response.StatusCode, $request.HttpMethod, $relative) -ForegroundColor $colour
        }
        catch {
            Write-Host ("  500  {0}" -f $_.Exception.Message) -ForegroundColor Red
            try { $response.StatusCode = 500 } catch {}
        }
        finally {
            try { $response.OutputStream.Close() } catch {}
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
