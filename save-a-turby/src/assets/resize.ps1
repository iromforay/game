param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Size = 0
)

if (-not (Test-Path $Path)) {
  Write-Error "File not found: $Path"
  exit 1
}

$full = (Resolve-Path $Path).Path

# default size by folder, per docs/save_a_turby_asset.md
if ($Size -eq 0) {
  if ($full -match '\\avatar\\') { $Size = 128 }
  elseif ($full -match '\\turby\\') { $Size = 512 }
  elseif ($full -match '\\backgrounds\\') { $Size = 256 }
  elseif ($full -match '\\village\\') { $Size = 256 }
  else { $Size = 256 }
}

Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($full)
$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$bmp.SetResolution($img.HorizontalResolution, $img.VerticalResolution)

$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($img, 0, 0, $Size, $Size)

$img.Dispose()
$g.Dispose()

# overwrite via temp file since the file handle must be released first
$tmp = "$full.tmp.png"
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Move-Item -Force $tmp $full

Write-Host "Resized to ${Size}x${Size}: $full"
