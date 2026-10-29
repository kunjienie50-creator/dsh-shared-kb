@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "DATA=%USERPROFILE%\.dsh-shared-kb"
if not exist "%DATA%" mkdir "%DATA%"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。请先安装 Node.js 20+：https://nodejs.org
  pause
  exit /b 1
)

if not exist "%DATA%\config.json" (
  echo 第一次启动，先建管理员。
  set /p NAME=你的名字（会显示为文档作者）:
  if "%NAME%"=="" set NAME=管理员
  node hub.js --data "%DATA%" --add-member "%NAME%" --admin
  echo.
)

echo.
echo ==============================================
for /f "delims=" %%A in ('node -e "try{const c=require(process.env.USERPROFILE+'\.dsh-shared-kb\config.json');const a=(c.members||[]).find(m=>m.role==='admin');process.stdout.write(a?a.name:'')}catch(e){}"') do set ADMIN=%%A
if not "%ADMIN%"=="" (
  echo 管理员「%ADMIN%」的邀请码（粘到插件页即可登录）：
  node hub.js --data "%DATA%" --invite "%ADMIN%"
)
echo.
echo ==============================================
echo  团队知识库启动在 8787 端口
echo  成员装插件地址：http://本机IP:8787/install/dsh-shared-kb-0.2.2.tgz
echo  其他成员连接时用你在「管理」页生成的邀请码。
echo  关掉这个窗口 = 停止服务。
echo ==============================================
echo.
node hub.js --data "%DATA%" --port 8787 --host 0.0.0.0
pause
