@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   AlgoDojo 本地服务已启动
echo   电脑访问: http://localhost:8080
echo   同一 WiFi 的手机访问:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:8080
echo.
echo   关闭本窗口即停止服务
echo.
python -m http.server 8080 --bind 0.0.0.0
pause