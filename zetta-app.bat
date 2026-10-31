@echo off
rem Abre a interface da Zetta e ela fala o resumo assim que a janela abre.
rem O Chrome bloqueia audio antes do primeiro clique; por isso a janela usa um
rem perfil proprio com autoplay liberado. ?morning=1 faz falar em toda abertura.
setlocal
cd /d D:\jarvis
set PORT=8000
set URL=http://127.0.0.1:%PORT%

curl -s -m 2 %URL%/health >nul 2>&1
if not errorlevel 1 goto ready

start "Zetta servidor" /min cmd /c uv run jarvis serve --port %PORT%
set /a TRIES=0
:wait
curl -s -m 2 %URL%/health >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 90 goto failed
timeout /t 1 /nobreak >nul
goto wait

:failed
echo O servidor nao respondeu em %URL%.
pause
exit /b 1

:ready
set BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%BROWSER%" goto launch
set BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%BROWSER%" goto launch
echo Chrome ou Edge nao encontrado.
pause
exit /b 1

:launch
start "" "%BROWSER%" --app=%URL%/?morning=1 --autoplay-policy=no-user-gesture-required --user-data-dir="%LOCALAPPDATA%\Zetta\browser-profile"
