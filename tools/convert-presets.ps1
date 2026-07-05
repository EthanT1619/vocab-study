# xlsx -> JSON 변환 (presets-source -> presets)
# 사용법: tools\convert-presets.bat

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$SourceRoot = Join-Path $Root 'presets-source'
$OutRoot = Join-Path $Root 'presets'

$SkipWordValues = @('words', 'word', 'english', 'example', 'korean', 'no', 'no.')
$SkipWordPatterns = @('^Vocab\s*\d+$', '^Lesson\s*\d+$')

function Test-HasLatinLetter([string]$Text) {
  return $Text -match '[A-Za-z]'
}

function Test-SkipWord([string]$Word) {
  $trimmed = if ($Word) { $Word.Trim() } else { '' }
  if (-not $trimmed) { return $true }
  # B column must contain English letters (skips header rows and row numbers)
  if (-not (Test-HasLatinLetter $trimmed)) { return $true }
  if ($SkipWordValues -contains $trimmed.ToLower()) { return $true }
  foreach ($pattern in $SkipWordPatterns) {
    if ($trimmed -match $pattern) { return $true }
  }
  return $false
}

function Get-SharedStrings([string]$SharedStringsPath) {
  [xml]$xml = Get-Content -Path $SharedStringsPath -Encoding UTF8
  $strings = @()
  foreach ($si in $xml.sst.si) {
    if ($si.t) {
      $strings += [string]$si.t
    } elseif ($si.r) {
      $strings += (($si.r | ForEach-Object { [string]$_.t }) -join '')
    } else {
      $strings += ''
    }
  }
  return ,$strings
}

function Get-ColumnIndex([string]$CellRef) {
  if ($CellRef -match '^([A-Z]+)') {
    return $matches[1]
  }
  return ''
}

function Get-CellText($cell, [string[]]$SharedStrings) {
  if (-not $cell) { return '' }
  if ([string]$cell.t -eq 's') {
    $idx = [int]$cell.v
    if ($idx -ge 0 -and $idx -lt $SharedStrings.Length) {
      return [string]$SharedStrings[$idx]
    }
    return ''
  }
  if ($null -ne $cell.v) {
    return [string]$cell.v
  }
  return ''
}

function Convert-XlsxFile([string]$XlsxPath) {
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("vocab-xlsx-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $temp -Force | Out-Null

  try {
    Copy-Item -Path $XlsxPath -Destination (Join-Path $temp 'book.zip') -Force
    Expand-Archive -Path (Join-Path $temp 'book.zip') -DestinationPath (Join-Path $temp 'unzipped') -Force

    $sharedPath = Join-Path $temp 'unzipped\xl\sharedStrings.xml'
    $sheetPath = Join-Path $temp 'unzipped\xl\worksheets\sheet1.xml'
    if (-not (Test-Path $sheetPath)) {
      throw "sheet1.xml not found in $XlsxPath"
    }

    $sharedStrings = @()
    if (Test-Path $sharedPath) {
      $sharedStrings = Get-SharedStrings $sharedPath
    }

    [xml]$sheet = Get-Content -Path $sheetPath -Encoding UTF8
    $words = New-Object System.Collections.Generic.List[object]

    foreach ($row in $sheet.worksheet.sheetData.row) {
      $cells = @{}
      foreach ($cell in $row.c) {
        $col = Get-ColumnIndex ([string]$cell.r)
        if ($col) {
          $cells[$col] = Get-CellText $cell $sharedStrings
        }
      }

      $word = if ($cells['B']) { $cells['B'].Trim() } else { '' }
      if (Test-SkipWord $word) { continue }

      $words.Add([ordered]@{
        word    = $word
        korean  = if ($cells['C']) { $cells['C'].Trim() } else { '' }
        english = if ($cells['D']) { $cells['D'].Trim() } else { '' }
        example = if ($cells['E']) { $cells['E'].Trim() } else { '' }
      })
    }

    return ,$words.ToArray()
  } finally {
    if (Test-Path $temp) {
      Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-OutputFileName([string]$FileName) {
  if ($FileName -match '(?i)Vocab\s*(\d+)') {
    return "vocab$($Matches[1]).json"
  }
  return 'words.json'
}

function Get-ListDisplayName([string]$JsonFileName) {
  if ($JsonFileName -match '^vocab(\d+)\.json$') {
    return "Vocab $($Matches[1])"
  }
  if ($JsonFileName -eq 'words.json') {
    return 'Words'
  }
  return [System.IO.Path]::GetFileNameWithoutExtension($JsonFileName)
}

function Get-LessonSortKey([string]$LessonFolderName) {
  if ($LessonFolderName -match '(\d+)') {
    return [int]$Matches[1]
  }
  return 9999
}

function Get-LessonId([string]$LessonFolderName) {
  if ($LessonFolderName -match '(\d+)') {
    return "lesson-$($Matches[1])"
  }
  return ($LessonFolderName.ToLower() -replace '\s+', '-')
}

function Update-Manifest {
  param([string]$PresetsRoot)

  $manifestPath = Join-Path $PresetsRoot 'manifest.json'
  $defaultLevelIds = @('DSA', 'DSB', 'DSC', 'DSD', 'LSA', 'LSB', 'LSC')
  $levelOrder = [System.Collections.Generic.List[string]]::new()

  if (Test-Path $manifestPath) {
    try {
      $existing = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($existing.levels) {
        foreach ($level in $existing.levels) {
          if ($level.id -and -not $levelOrder.Contains($level.id)) {
            $levelOrder.Add($level.id)
          }
        }
      }
    } catch {
      Write-Host "Warning: could not read existing manifest, using defaults."
    }
  }

  foreach ($id in $defaultLevelIds) {
    if (-not $levelOrder.Contains($id)) {
      $levelOrder.Add($id)
    }
  }

  $levelMap = @{}
  $jsonFiles = Get-ChildItem -Path $PresetsRoot -Recurse -File -Filter *.json |
    Where-Object { $_.Name -ne 'manifest.json' }

  foreach ($json in $jsonFiles) {
    $rel = $json.FullName.Substring($PresetsRoot.Length).TrimStart('\', '/')
    $rel = $rel -replace '\\', '/'
    $parts = $rel -split '/'
    if ($parts.Count -lt 3) { continue }

    $levelId = $parts[0]
    $lessonName = $parts[1]
    $fileName = $parts[2]

    if (-not $levelMap.ContainsKey($levelId)) {
      $levelMap[$levelId] = @{}
    }
    if (-not $levelMap[$levelId].ContainsKey($lessonName)) {
      $levelMap[$levelId][$lessonName] = @()
    }

    $sortKey = 9999
    if ($fileName -match '^vocab(\d+)\.json$') {
      $sortKey = [int]$Matches[1]
    }

    $levelMap[$levelId][$lessonName] += [ordered]@{
      fileName = $fileName
      filePath = $rel
      listName = Get-ListDisplayName $fileName
      sortKey  = $sortKey
    }

    if (-not $levelOrder.Contains($levelId)) {
      $levelOrder.Add($levelId)
    }
  }

  $levels = New-Object System.Collections.Generic.List[object]
  foreach ($levelId in $levelOrder) {
    $lessonList = New-Object System.Collections.Generic.List[object]

    if ($levelMap.ContainsKey($levelId)) {
      $lessonNames = $levelMap[$levelId].Keys | Sort-Object { Get-LessonSortKey $_ }
      foreach ($lessonName in $lessonNames) {
        $items = @($levelMap[$levelId][$lessonName] | Sort-Object { [int]$_.sortKey })
        $lessonObj = [ordered]@{
          id   = Get-LessonId $lessonName
          name = $lessonName
        }

        $useLists = ($items.Count -gt 1) -or ($items[0].fileName -match '^vocab\d+\.json$')
        if ($useLists) {
          $lists = New-Object System.Collections.Generic.List[object]
          foreach ($item in $items) {
            $lists.Add([ordered]@{
              name = $item.listName
              file = $item.filePath
            })
          }
          $lessonObj['lists'] = $lists.ToArray()
        } else {
          $lessonObj['file'] = $items[0].filePath
        }

        $lessonList.Add($lessonObj)
      }
    }

    $levels.Add([ordered]@{
      id      = $levelId
      name    = $levelId
      lessons = $lessonList.ToArray()
    })
  }

  $manifest = [ordered]@{ levels = $levels.ToArray() }
  $jsonArgs = @{ Depth = 6 }
  if ($PSVersionTable.PSVersion.Major -ge 7) {
    $jsonArgs['Indent'] = 2
  }
  $json = $manifest | ConvertTo-Json @jsonArgs
  [System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Updated: $manifestPath"
}

if (-not (Test-Path $SourceRoot)) {
  Write-Host "presets-source folder not found: $SourceRoot"
  exit 1
}

$files = Get-ChildItem -Path $SourceRoot -Recurse -File -Filter *.xlsx
if ($files.Count -eq 0) {
  Write-Host "No .xlsx files found under presets-source"
} else {
  $converted = 0
  foreach ($file in $files) {
    $relativeDir = Split-Path $file.FullName.Substring($SourceRoot.Length).TrimStart('\') -Parent
    $outDir = if ($relativeDir) { Join-Path $OutRoot $relativeDir } else { $OutRoot }
    $outName = Get-OutputFileName $file.Name
    $outPath = Join-Path $outDir $outName

    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    $words = Convert-XlsxFile $file.FullName
    $json = $words | ConvertTo-Json -Depth 4
    if ($words.Count -eq 1) {
      $json = "[$json]"
    }
    [System.IO.File]::WriteAllText($outPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Converted: $($file.FullName) -> $outPath ($($words.Count) words)"
    $converted++
  }

  Write-Host "Done. $converted file(s) converted."
}

Update-Manifest -PresetsRoot $OutRoot
