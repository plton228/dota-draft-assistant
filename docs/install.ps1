# Draft Assistant — встановлення одним рядком (PowerShell). Команду з закріпленим комітом дає програма:
#   «Налаштування → Довідка → Поділитися з другом».
# Ставить закріплену версію ($version) з GitHub Releases, але лише якщо контрольна сума архіву збігається з
# вписаною тут ($sha256): підмінений на GitHub архів не встановиться. Далі програма оновлюється сама — і приймає
# лише оновлення з підписом автора (з 0.23.0), тож закріплена версія не застаріває.
# Розпаковує в %LOCALAPPDATA%\DraftAssistant, створює ярлики на робочому столі й у меню «Пуск» і запускає програму.
# Уже встановлено — нічого не перезаписує (там ваші дані й налаштування). Налаштувань захисту Windows не чіпає.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # без смуги прогресу Invoke-WebRequest завантажує в рази швидше
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$version = '0.23.0'
$sha256 = 'c1bca8fa7e5599d0cc99ce012079a766bd032b51b07203f3ae7b4f0c3facdcc0'
$url = "https://github.com/plton228/dota-draft-assistant/releases/download/v$version/DraftAssistant-win64.zip"
$root = if ($env:DA_INSTALL_ROOT) { $env:DA_INSTALL_ROOT } else { $env:LOCALAPPDATA }
$dest = Join-Path $root 'DraftAssistant'
$exe = Join-Path $dest 'DraftAssistant.exe'
$links = if ($env:DA_LINKS_DIR) { @($env:DA_LINKS_DIR) } else {
    @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
}

function New-DaShortcut([string]$path) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $dest
    $link.Description = 'Draft Assistant'
    $link.Save()
}

if (Test-Path $exe) {
    Write-Host "Draft Assistant вже встановлено: $dest" -ForegroundColor Green
    Write-Host 'Запускаю — нові версії програма завантажує сама.'
} else {
    $zip = Join-Path $env:TEMP ("DraftAssistant-" + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        Write-Host "Draft Assistant $version`: завантажую (~110 МБ)..." -ForegroundColor Cyan
        Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
        $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
        if ($actual -ne $sha256) {
            throw "Контрольна сума архіву не збігається (очікувалась $sha256, отримано $actual) — нічого не встановлено."
        }
        Write-Host 'Контрольна сума збігається.'
        Write-Host "Розпаковую в $dest ..."
        New-Item -ItemType Directory -Force -Path $root | Out-Null
        Expand-Archive -Path $zip -DestinationPath $root -Force  # в архіві — тека DraftAssistant
    } finally {
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $exe)) { throw "Після розпакування немає $exe" }
    foreach ($folder in $links) { New-DaShortcut (Join-Path $folder 'Draft Assistant.lnk') }
    Write-Host "Готово: Draft Assistant $version у $dest, ярлики — на робочому столі й у меню «Пуск»." -ForegroundColor Green
    Write-Host 'Новішу версію програма запропонує сама на сторінці «Головна».'
}

if (-not $env:DA_NO_START) { Start-Process -FilePath $exe -WorkingDirectory $dest }
