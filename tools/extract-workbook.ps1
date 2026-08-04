<#
    extract-workbook.ps1

    Converts "Gym Exercise Compendium.xlsx" into the typed JSON the app ships with.
    The workbook stays the authoring surface: edit it in Excel, re-run this, commit the JSON.

    No Node, no Python, no modules -- just Expand-Archive and the .NET XML parser
    against the raw OOXML inside the .xlsx.

    Usage (from the project root):
        powershell -ExecutionPolicy Bypass -File tools\extract-workbook.ps1
#>

[CmdletBinding()]
param(
    [string]$Workbook,
    [string]$OutDir
)

$ErrorActionPreference = "Stop"

# Resolved here rather than as param defaults: when the script is launched with
# a relative path, $PSScriptRoot is still empty during parameter binding.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Workbook) { $Workbook = Join-Path $scriptDir "..\Gym Exercise Compendium.xlsx" }
if (-not $OutDir)   { $OutDir   = Join-Path $scriptDir "..\data" }

# ---------------------------------------------------------------- xlsx plumbing

function Expand-Workbook {
    param([string]$Path)

    if (-not (Test-Path $Path)) { throw "Workbook not found: $Path" }

    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("xlsx-extract-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Force $work | Out-Null

    # Expand-Archive only accepts .zip, so copy the workbook under a .zip name first.
    $zip = Join-Path $work "book.zip"
    Copy-Item $Path $zip -Force
    Expand-Archive $zip -DestinationPath (Join-Path $work "x") -Force

    return (Join-Path $work "x")
}

function Get-SharedStrings {
    param([string]$Root)

    $file = Join-Path $Root "xl\sharedStrings.xml"
    if (-not (Test-Path $file)) { return @() }

    [xml]$doc = Get-Content $file -Encoding UTF8
    $out = New-Object System.Collections.Generic.List[string]

    # A shared string is either a single <t>, or rich text split across several
    # <r><t>..</t></r> runs that have to be concatenated back together.
    foreach ($si in $doc.sst.si) {
        $parts = $si.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }
        $out.Add(($parts -join ""))
    }
    return $out
}

function Get-SheetMap {
    param([string]$Root)

    [xml]$wb   = Get-Content (Join-Path $Root "xl\workbook.xml") -Encoding UTF8
    [xml]$rels = Get-Content (Join-Path $Root "xl\_rels\workbook.xml.rels") -Encoding UTF8

    $byId = @{}
    foreach ($r in $rels.Relationships.Relationship) { $byId[$r.Id] = $r.Target }

    $map = [ordered]@{}
    foreach ($s in $wb.workbook.sheets.sheet) {
        # The r:id attribute lives in the relationships namespace.
        $rid = $s.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        $map[$s.name] = Join-Path $Root ("xl\" + ($byId[$rid] -replace "/", "\"))
    }
    return $map
}

function ConvertTo-ColumnIndex {
    param([string]$Ref)   # "AB12" -> 28

    $letters = ($Ref -replace "\d", "")
    $n = 0
    foreach ($ch in $letters.ToCharArray()) {
        $n = $n * 26 + ([int][char]::ToUpper($ch) - 64)
    }
    return $n
}

function Read-Sheet {
    <#
        Returns an array of hashtables keyed by column letter, one per row,
        each carrying a _row key with the 1-based sheet row number.
        Formula cells resolve to their cached value, which is what we want --
        the app reimplements the logic, it doesn't evaluate the formulas.
    #>
    param([string]$Path, [string[]]$Strings)

    [xml]$sh = Get-Content $Path -Encoding UTF8
    $rows = New-Object System.Collections.Generic.List[hashtable]

    foreach ($row in $sh.worksheet.sheetData.row) {
        $bag = @{ _row = [int]$row.r }
        foreach ($c in $row.c) {
            $col = ($c.r -replace "\d", "")
            $val = $null

            switch ($c.t) {
                "s"         { if ($null -ne $c.v) { $val = $Strings[[int]$c.v] } }
                "inlineStr" { $val = $c.is.t }
                "b"         { $val = ($c.v -eq "1") }
                default     { $val = $c.v }
            }

            if ($null -ne $val -and "$val".Trim() -ne "") { $bag[$col] = "$val".Trim() }
        }
        $rows.Add($bag)
    }
    return $rows
}

function Get-Cell {
    param([hashtable]$Row, [string]$Col)
    if ($Row.ContainsKey($Col)) { return $Row[$Col] }
    return $null
}

function Get-Number {
    param([hashtable]$Row, [string]$Col)
    $v = Get-Cell $Row $Col
    if ($null -eq $v) { return $null }
    $parsed = 0.0
    if ([double]::TryParse($v, [ref]$parsed)) { return $parsed }
    return $null
}

function Split-List {
    <# "Glutes, Hamstrings, Core" -> @("Glutes","Hamstrings","Core") #>
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    return @($Value -split "\s*,\s*" | Where-Object { $_ -ne "" })
}

function Write-Json {
    param($Object, [string]$Path)

    $json = $Object | ConvertTo-Json -Depth 12
    # PS 5.1 writes UTF-8 with a BOM via Set-Content; write it ourselves without one.
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------------- extract

Write-Host "Reading $Workbook" -ForegroundColor Cyan

$root    = Expand-Workbook -Path $Workbook
$strings = Get-SharedStrings -Root $root
$sheets  = Get-SheetMap -Root $root

Write-Host ("  {0} shared strings, {1} sheets" -f $strings.Count, $sheets.Count)

# --- Exercise Library ------------------------------------------------------
# Row 4 is the header; data starts at row 5.
# A id | B name(en) | C name(sv) | D equipment | E pattern | F primary
# G secondary | H profile | I cue | J "Your 1RM" (user data -- deliberately not shipped)

$exRows    = Read-Sheet -Path $sheets["Exercise Library"] -Strings $strings
$exercises = New-Object System.Collections.Generic.List[object]
$oneRmSeen = New-Object System.Collections.Generic.List[string]

foreach ($r in $exRows) {
    if ($r._row -lt 5) { continue }
    $name = Get-Cell $r "B"
    if (-not $name) { continue }

    $oneRm = Get-Number $r "J"
    if ($null -ne $oneRm) { $oneRmSeen.Add("$name = $oneRm kg") }

    $exercises.Add([ordered]@{
        id        = [int](Get-Cell $r "A")
        name      = [ordered]@{ en = $name; sv = (Get-Cell $r "C") }
        equipment = Get-Cell $r "D"
        pattern   = Get-Cell $r "E"
        primary   = Get-Cell $r "F"
        secondary = @(Split-List (Get-Cell $r "G"))
        profile   = Get-Cell $r "H"
        cue       = Get-Cell $r "I"
    })
}

# --- Warm-Up Library -------------------------------------------------------
# A id | B drill(en) | C drill(sv) | D phase | E phase order | F trigger
# G priority | H minutes | I how-to

$wuRows  = Read-Sheet -Path $sheets["Warm-Up Library"] -Strings $strings
$warmups = New-Object System.Collections.Generic.List[object]

foreach ($r in $wuRows) {
    if ($r._row -lt 5) { continue }
    $name = Get-Cell $r "B"
    if (-not $name) { continue }

    $warmups.Add([ordered]@{
        id         = [int](Get-Cell $r "A")
        name       = [ordered]@{ en = $name; sv = (Get-Cell $r "C") }
        phase      = Get-Cell $r "D"
        phaseOrder = [int](Get-Number $r "E")
        trigger    = Get-Cell $r "F"
        priority   = [int](Get-Number $r "G")
        minutes    = Get-Number $r "H"
        how        = [ordered]@{ en = (Get-Cell $r "I"); sv = $null }
    })
}

# --- Mobility Library ------------------------------------------------------
# Same shape as warm-ups, but D/E are type/type order and F is the muscle target.

$moRows    = Read-Sheet -Path $sheets["Mobility Library"] -Strings $strings
$mobility  = New-Object System.Collections.Generic.List[object]

foreach ($r in $moRows) {
    if ($r._row -lt 5) { continue }
    $name = Get-Cell $r "B"
    if (-not $name) { continue }

    $mobility.Add([ordered]@{
        id        = [int](Get-Cell $r "A")
        name      = [ordered]@{ en = $name; sv = (Get-Cell $r "C") }
        type      = Get-Cell $r "D"
        typeOrder = [int](Get-Number $r "E")
        target    = Get-Cell $r "F"
        priority  = [int](Get-Number $r "G")
        minutes   = Get-Number $r "H"
        how       = [ordered]@{ en = (Get-Cell $r "I"); sv = $null }
    })
}

# --- Prescriptions ---------------------------------------------------------
# A composite key | B profile | C goal | D sets | E reps | F load | G loadMin
# H loadMax | I rest | J note | K sets(avg) | L work per set (s) | M rest(avg, s)
# Row 28 column D holds the flat set-up allowance per exercise, in seconds.

$prRows        = Read-Sheet -Path $sheets["Prescriptions"] -Strings $strings
$prescriptions = New-Object System.Collections.Generic.List[object]
$setupSeconds  = 90

foreach ($r in $prRows) {
    if ($r._row -lt 5) { continue }

    $profile = Get-Cell $r "B"
    $goal    = Get-Cell $r "C"

    if ($profile -and $goal) {
        $prescriptions.Add([ordered]@{
            profile       = $profile
            goal          = $goal
            sets          = Get-Cell $r "D"
            reps          = Get-Cell $r "E"
            load          = Get-Cell $r "F"
            loadMin       = Get-Number $r "G"
            loadMax       = Get-Number $r "H"
            rest          = Get-Cell $r "I"
            note          = Get-Cell $r "J"
            setsAvg       = Get-Number $r "K"
            workPerSetSec = Get-Number $r "L"
            restAvgSec    = Get-Number $r "M"
        })
    }

    # "Set-up and transition per exercise (seconds)" sits below the table.
    $label = Get-Cell $r "A"
    if ($label -and $label -like "Set-up and transition*") {
        $n = Get-Number $r "D"
        if ($null -ne $n) { $setupSeconds = $n }
    }
}

# ------------------------------------------------------------------ vocabulary
# Distinct value sets, so the UI can build filters without scanning at runtime
# and so a typo in the workbook shows up here rather than as an empty dropdown.

# The rows are OrderedDictionary, so pull keys explicitly rather than relying on
# member enumeration, which silently yields nothing for dictionaries.
function Get-Distinct {
    param($Rows, [string]$Key)
    return @($Rows | ForEach-Object { $_[$Key] } | Where-Object { $_ } | Sort-Object -Unique)
}

# Ordered by the workbook's own ordering column, not alphabetically.
function Get-OrderedDistinct {
    param($Rows, [string]$Key, [string]$OrderKey)
    $seen = New-Object System.Collections.Generic.List[string]
    foreach ($r in ($Rows | Sort-Object { [int]$_[$OrderKey] })) {
        if ($r[$Key] -and -not $seen.Contains($r[$Key])) { $seen.Add($r[$Key]) }
    }
    return @($seen)
}

$primaryAll   = @($exercises | ForEach-Object { $_["primary"] })
$secondaryAll = @($exercises | ForEach-Object { $_["secondary"] } | ForEach-Object { $_ })

$vocabulary = [ordered]@{
    equipment      = Get-Distinct $exercises "equipment"
    patterns       = Get-Distinct $exercises "pattern"
    muscles        = @($primaryAll + $secondaryAll | Where-Object { $_ } | Sort-Object -Unique)
    primaryMuscles = Get-Distinct $exercises "primary"
    profiles       = Get-Distinct $prescriptions "profile"
    # Goals stay in workbook order (Explosivity, Strength, Muscular endurance),
    # which is a progression, not an alphabetical list.
    goals          = @($prescriptions | ForEach-Object { $_["goal"] } | Select-Object -Unique)
    warmupPhases   = Get-OrderedDistinct $warmups  "phase" "phaseOrder"
    mobilityTypes  = Get-OrderedDistinct $mobility "type"  "typeOrder"
}

# ---------------------------------------------------------------------- output

$stamp = (Get-Date).ToString("yyyy-MM-dd")
$meta  = [ordered]@{
    source    = [System.IO.Path]::GetFileName((Resolve-Path $Workbook))
    generated = $stamp
    generator = "tools/extract-workbook.ps1"
}

Write-Json ([ordered]@{ meta = $meta; items = $exercises })     (Join-Path $OutDir "exercises.json")
Write-Json ([ordered]@{ meta = $meta; items = $warmups })       (Join-Path $OutDir "warmups.json")
Write-Json ([ordered]@{ meta = $meta; items = $mobility })      (Join-Path $OutDir "mobility.json")
Write-Json ([ordered]@{ meta = $meta; setupSecondsPerExercise = $setupSeconds; items = $prescriptions }) (Join-Path $OutDir "prescriptions.json")
Write-Json ([ordered]@{ meta = $meta } + $vocabulary)           (Join-Path $OutDir "vocabulary.json")

Remove-Item (Split-Path $root -Parent) -Recurse -Force -ErrorAction SilentlyContinue

# ----------------------------------------------------------------------- report

Write-Host ""
Write-Host "Written to $OutDir" -ForegroundColor Green
Write-Host ("  exercises.json      {0,4} exercises"    -f $exercises.Count)
Write-Host ("  warmups.json        {0,4} drills"       -f $warmups.Count)
Write-Host ("  mobility.json       {0,4} exercises"    -f $mobility.Count)
Write-Host ("  prescriptions.json  {0,4} combinations, set-up {1}s" -f $prescriptions.Count, $setupSeconds)
Write-Host ("  vocabulary.json     {0} equipment, {1} patterns, {2} muscles, {3} profiles, {4} goals" -f `
    $vocabulary.equipment.Count, $vocabulary.patterns.Count, $vocabulary.muscles.Count, `
    $vocabulary.profiles.Count, $vocabulary.goals.Count)

# Integrity check: an exercise whose profile has no prescription row silently
# produces a blank workout, so fail loudly here instead.
$known   = @{}
foreach ($p in $prescriptions) { $known[$p.profile] = $true }
$orphans = @($exercises | Where-Object { -not $known.ContainsKey($_.profile) })

if ($orphans.Count) {
    Write-Host ""
    Write-Host ("  WARNING: {0} exercise(s) reference a profile with no prescription row:" -f $orphans.Count) -ForegroundColor Yellow
    $orphans | ForEach-Object { Write-Host ("    {0} -> '{1}'" -f $_.name.en, $_.profile) -ForegroundColor Yellow }
}

$missingSv = @($exercises | Where-Object { -not $_.name.sv }).Count
if ($missingSv) { Write-Host ("  {0} exercise(s) have no Swedish name yet." -f $missingSv) -ForegroundColor Yellow }

if ($oneRmSeen.Count) {
    Write-Host ""
    Write-Host ("  {0} 1RM value(s) found in the workbook -- NOT shipped (user data lives in the app):" -f $oneRmSeen.Count) -ForegroundColor DarkGray
    $oneRmSeen | ForEach-Object { Write-Host ("    $_") -ForegroundColor DarkGray }
}
