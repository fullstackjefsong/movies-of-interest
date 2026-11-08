$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(24, 30, 40))
$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 199, 130))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 30, 40))
$pen = New-Object System.Drawing.Pen $gold, 7
$graphics.DrawRectangle($pen, 9, 9, 238, 238)
$bookmark = [System.Drawing.Point[]]@(
  [System.Drawing.Point]::new(72, 70), [System.Drawing.Point]::new(184, 70),
  [System.Drawing.Point]::new(184, 200), [System.Drawing.Point]::new(128, 168),
  [System.Drawing.Point]::new(72, 200))
$graphics.FillPolygon($gold, $bookmark)
$triangle = [System.Drawing.Point[]]@(
  [System.Drawing.Point]::new(112, 96), [System.Drawing.Point]::new(162, 125),
  [System.Drawing.Point]::new(112, 154))
$graphics.FillPolygon($dark, $triangle)
foreach ($x in @(72, 109, 146, 184)) { $graphics.DrawLine($pen, $x, 43, $x, 70) }
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
$out = Join-Path $PSScriptRoot '..\dist\MoviesOfInterest.ico'
$writer = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($out))
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
$writer.Dispose(); $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
$gold.Dispose(); $dark.Dispose(); $pen.Dispose()
