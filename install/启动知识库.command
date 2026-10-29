#!/bin/bash
# 双击启动团队共享知识库 Hub（macOS）
# 首次运行会让你输入管理员名字，之后每次双击就是启动服务。
cd "$(dirname "$0")/.." || exit 1
DIR="$(pwd)"

NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node 2>/dev/null | head -1)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "找不到 Node.js。"
  echo "请先安装 Node.js 20+（https://nodejs.org），或确认这台电脑装过 DeepSeek Harness。"
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

DATA="$HOME/.dsh-shared-kb"
mkdir -p "$DATA"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
URL="http://$IP:8787"

if [ ! -f "$DATA/config.json" ]; then
  echo "第一次启动，先建管理员。"
  echo -n "你的名字（会显示为文档作者）："
  read -r NAME
  [ -z "$NAME" ] && NAME="管理员"
  "$NODE" hub.js --data "$DATA" --add-member "$NAME" --admin --url "$URL"
  echo
fi

echo
echo "=============================================="
echo " 团队知识库已启动：$URL"
echo " 成员装插件地址：$URL/install/dsh-shared-kb-0.2.0.tgz"
echo " 其他成员连接时用你在「管理」页生成的邀请码。"
echo " 关掉这个窗口 = 停止服务。"
echo "=============================================="
echo
exec "$NODE" hub.js --data "$DATA" --port 8787 --host 0.0.0.0 --url "$URL"
